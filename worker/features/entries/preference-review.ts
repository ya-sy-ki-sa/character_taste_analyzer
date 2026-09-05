import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { anyEntryDraftSchema } from "../../../shared/contracts/entries";
import type { PreferenceReviewMutation } from "../../../shared/contracts/reviews";
import { darkResponseChannelValues } from "../../../shared/dark-response-channels";
import { entryScopeText } from "../../../shared/entry-input";
import { responseChannelValues } from "../../../shared/response-channels";
import { deriveUuid, normalizeIdentityPart, nowIso } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
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
    repository.selectPreferenceAssertions2(env.DB, [changedId, ownerUserId, changedId, ownerUserId]),
  );
  if (alreadyExists) return { analysisRunId, changedId, action: input.action, replayed: true };
  const run = await first<{
    entry_revision_id: string;
    character_identity_id: string;
    representation_id: string;
    registration_payload_json: string;
  }>(repository.selectAnalysisRuns2(env.DB, [analysisRunId, ownerUserId, ownerUserId, analysisDomain]));
  if (!run) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");
  const now = nowIso();
  const draft = anyEntryDraftSchema.parse(JSON.parse(run.registration_payload_json));
  const contextJson = JSON.stringify({
    schemaVersion: "2",
    entryScope: entryScopeText(draft),
    subjects: [],
    relationships: [],
    narrativePhases: [],
    conditions: ["ユーザーが確認画面で追加・修正"],
    exceptions: [],
  });
  if (input.action === "add_preference" || input.action === "update_preference") {
    const allowedChannels = analysisDomain === "dark" ? darkResponseChannelValues : responseChannelValues;
    if (!(allowedChannels as readonly string[]).includes(input.responseChannel))
      throw new Error("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    const attribute = input.attributeStableKey
      ? await first<{ id: string }>(
          repository.selectAttributeDefinitions(env.DB, [input.attributeStableKey, analysisDomain]),
        )
      : null;
    if (input.attributeStableKey && !attribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
    const rawId = await deriveUuid(env.AUTH_PEPPER, `${changedId}:raw`);
    const old =
      input.action === "update_preference"
        ? await first<{ raw_mention_id: string | null; context_json: string }>(
            repository.selectPreferenceAssertions3(env.DB, [input.targetId, ownerUserId, analysisRunId]),
          )
        : null;
    if (input.action === "update_preference" && !old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
    const statements: D1PreparedStatement[] = [
      ...(old?.raw_mention_id
        ? [repository.updateAttributeMappings(env.DB, [ownerUserId, now, old.raw_mention_id])]
        : []),
      repository.insertRawAttributeMentions(env.DB, [
        rawId,
        ownerUserId,
        changedId,
        input.rawLabel,
        normalizeIdentityPart(input.rawLabel),
        now,
      ]),
      repository.insertAttributeMappings(env.DB, [
        crypto.randomUUID(),
        rawId,
        attribute?.id ?? null,
        attribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ]),
      repository.insertPreferenceAssertions(env.DB, [
        changedId,
        ownerUserId,
        analysisRunId,
        run.entry_revision_id,
        run.character_identity_id,
        run.representation_id,
        attribute?.id ?? null,
        rawId,
        analysisDomain,
        input.polarity,
        input.responseChannel,
        input.strength,
        old?.context_json ?? contextJson,
        now,
      ]),
      ...(input.action === "update_preference"
        ? [repository.updatePreferenceAssertions2(env.DB, [changedId, input.targetId, ownerUserId, analysisRunId])]
        : []),
    ];
    const results = await env.DB.batch(statements);
    if (results.some((item) => !item.success) || !results.at(-1)?.meta.changes)
      throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  } else {
    const old =
      input.action === "update_value_stance"
        ? await first<{ scope_json: string }>(
            repository.selectValueStanceAssertions(env.DB, [input.targetId, ownerUserId, analysisRunId]),
          )
        : null;
    if (input.action === "update_value_stance" && !old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
    const statements: D1PreparedStatement[] = [
      repository.insertValueStanceAssertions(env.DB, [
        changedId,
        ownerUserId,
        analysisRunId,
        input.targetRef,
        input.stance,
        input.orientation,
        old?.scope_json ?? contextJson,
        now,
      ]),
      ...(input.action === "update_value_stance"
        ? [repository.updateValueStanceAssertions2(env.DB, [changedId, input.targetId, ownerUserId, analysisRunId])]
        : []),
    ];
    const results = await env.DB.batch(statements);
    if (results.some((item) => !item.success) || !results.at(-1)?.meta.changes)
      throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  }
  return { analysisRunId, changedId, action: input.action, replayed: false };
}
