import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { anyEntryDraftSchema } from "../../../shared/contracts/entries";
import type { PreferenceReviewMutation } from "../../../shared/contracts/reviews";
import { darkResponseChannelValues } from "../../../shared/dark-response-channels";
import { entryScopeText } from "../../../shared/entry-input";
import { responseChannelValues } from "../../../shared/response-channels";
import { deriveUuid, normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import { PREFERENCE_CONFIRMATION_POLICY, preferenceConfirmationText } from "./preference-confirmation";
import { confirmationStatements } from "./repositories/preference-confirmation";
import * as repository from "./repositories/preference-review";

export async function rejectPreferenceAnalysisItem(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  analysisRunId: string,
  targetId: string,
): Promise<{
  analysisRunId: string;
  targetId: string;
  targetType: "preference_assertion" | "value_stance_assertion";
  replayed: boolean;
}> {
  const run = await first<{ id: string }>(
    repository.selectAnalysisRuns(env.DB, [analysisRunId, ownerUserId, ownerUserId, analysisDomain]),
  );
  if (!run) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");

  const targets = await all<{
    target_type: "preference_assertion" | "value_stance_assertion";
    status: string;
  }>(
    repository.selectPreferenceAssertions(env.DB, [
      targetId,
      ownerUserId,
      analysisRunId,
      targetId,
      ownerUserId,
      analysisRunId,
    ]),
  );
  if (targets.length !== 1) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
  const target = targets[0];
  if (target.status === "rejected") {
    return { analysisRunId, targetId, targetType: target.target_type, replayed: true };
  }
  if (!new Set(["proposed", "corrected"]).has(target.status)) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");

  const statement =
    target.target_type === "preference_assertion"
      ? repository.updatePreferenceAssertions(env.DB)
      : repository.updateValueStanceAssertions(env.DB);
  const result = await statement.bind(targetId, ownerUserId, analysisRunId).run();
  if (!result.success) throw new Error("D1_PREFERENCE_REVIEW_FAILED");
  if (!result.meta.changes) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { analysisRunId, targetId, targetType: target.target_type, replayed: false };
}

export async function mutatePreferenceReview(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  analysisRunId: string,
  input: PreferenceReviewMutation,
  idempotencyKey: string,
): Promise<{
  analysisRunId: string;
  changedId: string;
  action: PreferenceReviewMutation["action"];
  replayed: boolean;
}> {
  const changedId = await deriveUuid(
    env.AUTH_PEPPER,
    `preference-review:${ownerUserId}:${analysisDomain}:${analysisRunId}:${idempotencyKey}`,
  );
  const alreadyExists = await first<{ id: string }>(
    repository.selectOwnedReviewTarget(env.DB, [changedId, ownerUserId, changedId, ownerUserId]),
  );
  if (alreadyExists) return { analysisRunId, changedId, action: input.action, replayed: true };
  const run = await first<{
    entry_revision_id: string;
    character_identity_id: string;
    representation_id: string;
    registration_payload_json: string;
  }>(repository.selectEditableAnalysisRun(env.DB, [analysisRunId, ownerUserId, ownerUserId, analysisDomain]));
  if (!run) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");
  const now = nowIso();
  if (input.action === "set_response_channel") {
    const allowed = analysisDomain === "dark" ? darkResponseChannelValues : responseChannelValues;
    if (input.responseChannel !== null && !(allowed as readonly string[]).includes(input.responseChannel))
      throw new Error("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    const evidence = await all<{ id: string }>(
      repository.selectPreferenceEvidenceIds(env.DB, [input.targetId, ownerUserId]),
    );
    const copies = await Promise.all(
      evidence.map(async (item) =>
        repository.copyPreferenceEvidence(env.DB, [
          await deriveUuid(env.AUTH_PEPPER, `${changedId}:evidence:${item.id}`),
          changedId,
          item.id,
          ownerUserId,
          changedId,
        ]),
      ),
    );
    const results = await env.DB.batch([
      repository.copyPreferenceWithChannel(env.DB, [
        changedId,
        input.responseChannel,
        now,
        input.targetId,
        ownerUserId,
        analysisRunId,
      ]),
      ...copies,
      repository.supersedeReplacedPreferenceAssertion(env.DB, [
        changedId,
        input.targetId,
        ownerUserId,
        analysisRunId,
        changedId,
      ]),
    ]);
    if (results.some((item) => !item.success)) throw new Error("D1_PREFERENCE_REVIEW_FAILED");
    if (!results[0]?.meta.changes) {
      const replay = await first<{ id: string }>(
        repository.selectOwnedReviewTarget(env.DB, [changedId, ownerUserId, changedId, ownerUserId]),
      );
      if (!replay) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
      return { analysisRunId, changedId, action: input.action, replayed: true };
    }
    return { analysisRunId, changedId, action: input.action, replayed: false };
  }
  const draft = anyEntryDraftSchema.parse(JSON.parse(run.registration_payload_json));
  let contextJson = JSON.stringify({
    schemaVersion: "2",
    entryScope: entryScopeText(draft),
    subjects: [],
    relationships: [],
    narrativePhases: [],
    conditions: [],
    exceptions: [],
  });
  let attribute: { id: string; label: string } | null = null;
  let oldRawId: string | null = null;
  let targetType = "value";
  if (input.action === "add_preference" || input.action === "update_preference") {
    const allowed = analysisDomain === "dark" ? darkResponseChannelValues : responseChannelValues;
    if (input.responseChannel !== null && !(allowed as readonly string[]).includes(input.responseChannel))
      throw new Error("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    attribute = input.attributeStableKey
      ? await first<{ id: string; label: string }>(
          repository.selectAttributeDefinitions(env.DB, [input.attributeStableKey, analysisDomain]),
        )
      : null;
    if (input.attributeStableKey && !attribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
    if (input.action === "update_preference") {
      const old = await first<{ raw_mention_id: string | null; context_json: string }>(
        repository.selectEditablePreferenceAssertion(env.DB, [input.targetId, ownerUserId, analysisRunId]),
      );
      if (!old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
      contextJson = old.context_json;
      oldRawId = old.raw_mention_id;
    }
  } else if (input.action === "update_value_stance") {
    const old = await first<{ scope_json: string; target_type: string }>(
      repository.selectValueStanceAssertions(env.DB, [input.targetId, ownerUserId, analysisRunId]),
    );
    if (!old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
    contextJson = old.scope_json;
    targetType = old.target_type;
  }
  const text = preferenceConfirmationText(input, contextJson, attribute?.label ?? null);
  const sourceId = await deriveUuid(env.AUTH_PEPPER, `${changedId}:confirmation-source`);
  const pointer = `/confirmedPreferences/${"rawLabel" in input ? "assertions" : "valueStances"}/${changedId}/declaration`;
  const writeToken = crypto.randomUUID();
  const metadata = {
    policyVersion: PREFERENCE_CONFIRMATION_POLICY,
    action: input.action,
    previousAssertionId: "targetId" in input ? input.targetId : null,
    assertionId: changedId,
    analysisRunId,
    analysisDomain,
    submitted: input,
    context: JSON.parse(contextJson),
    targetType: "rawLabel" in input ? "attribute" : targetType,
  };
  const results = await env.DB.batch(
    confirmationStatements(env.DB, {
      changedId,
      owner: ownerUserId,
      domain: analysisDomain,
      runId: analysisRunId,
      revisionId: run.entry_revision_id,
      identityId: run.character_identity_id,
      representationId: run.representation_id,
      input,
      contextJson,
      attributeId: attribute?.id ?? null,
      oldRawId,
      targetType,
      rawId: await deriveUuid(env.AUTH_PEPPER, `${changedId}:raw`),
      normalizedLabel: "rawLabel" in input ? normalizeIdentityPart(input.rawLabel) : "",
      mappingId: await deriveUuid(env.AUTH_PEPPER, `${changedId}:mapping`),
      sourceId,
      evidenceId: await deriveUuid(env.AUTH_PEPPER, `${changedId}:confirmation-evidence`),
      writeToken,
      text,
      hash: await sha256Hex(text),
      byteLength: new TextEncoder().encode(text).byteLength,
      locatorJson: JSON.stringify({ pointer, writeToken }),
      citationJson: JSON.stringify(metadata),
      pointer,
      now,
    }),
  );
  if (results.some((item) => !item.success)) throw new Error("D1_PREFERENCE_REVIEW_FAILED");
  if (!results[0]?.meta.changes) {
    const replay = await first<{ id: string }>(
      repository.selectOwnedReviewTarget(env.DB, [changedId, ownerUserId, changedId, ownerUserId]),
    );
    if (!replay) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
    return { analysisRunId, changedId, action: input.action, replayed: true };
  }
  return { analysisRunId, changedId, action: input.action, replayed: false };
}
