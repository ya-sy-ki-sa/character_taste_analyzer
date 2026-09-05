import { z } from "zod";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import { type PreferenceHypothesis, preferenceHypothesisSchema } from "../../../shared/contracts/refinement";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import { darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import { responseChannelCatalog } from "../../../shared/response-channels";
import { deriveUuid, hmacHex, nowIso, sha256Hex } from "../../lib/crypto";
import { all } from "../../lib/db";
import { HYPOTHESIS_SYSTEM } from "../../llm/prompts/hypotheses";
import type { LlmProvider } from "../../llm/types";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import * as repository from "./repositories/hypotheses";
import type { RetainedPreferences } from "./retention";

export async function generatePreferenceHypotheses(
  env: Env,
  llm: LlmProvider,
  owner: string,
  domain: AnalysisDomain,
  refinementId: string,
  revisionId: string,
  payload: AnyEntryDraft,
  understanding: UnderstandingCandidate,
  ontology: Array<{ stable_key: string; label: string }>,
  retained: RetainedPreferences,
  exclusions: unknown,
) {
  const previous = await all<{ hypotheses_json: string }>(
    repository.selectPreferenceRefinements(env.DB, [owner, revisionId]),
  );
  const previousCandidates = previous.flatMap((row) => JSON.parse(row.hypotheses_json) as PreferenceHypothesis[]);
  const channels = domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog;
  const schema = z.object({
    candidates: z
      .array(
        preferenceHypothesisSchema.extend({
          attributeStableKey: z.enum(ontology.map((item) => item.stable_key)),
          responseChannel: z.enum(channels.map((item) => item.value)),
        }),
      )
      .max(6),
  });
  const messages = [
    { role: "system" as const, content: HYPOTHESIS_SYSTEM },
    {
      role: "user" as const,
      content: JSON.stringify({
        domain,
        registration: payload,
        confirmedUnderstanding: understanding,
        existingPreferences: retained.preferences,
        existingValueStances: retained.stances,
        excludedPreferences: exclusions,
        previousCandidates,
        ontology,
        responseChannels: channels,
      }),
    },
  ];
  const result = await llm.generateStructured({
    operation: "preference_hypotheses",
    schemaName: "preference_hypotheses",
    schemaVersion: "2.1",
    schema,
    jsonSchema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: 8000,
    temperature: 0.6,
    idempotencyKey: `${revisionId}:hypotheses:${refinementId}`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${owner}`),
    fakeFactory: () => ({
      candidates: understanding.assertions.slice(0, 3).flatMap((assertion, index) => {
        const attribute = ontology.find((item) => item.stable_key === assertion.attributeStableKey);
        if (!attribute) return [];
        const channel = channels[(previous.length * 3 + index + 3) % channels.length];
        return [
          {
            attributeStableKey: attribute.stable_key,
            rawLabel: attribute.label,
            polarity: "positive" as const,
            responseChannel: channel.value,
            scope: payload.preferenceContext ?? "",
            description: `${attribute.label}について、${channel.label}として惹かれる。`,
            reason: `確認済みの「${assertion.valueText}」から考えられる、未確認の好みです。`,
          },
        ];
      }),
    }),
  });
  const allowedKeys = new Set(ontology.map((item) => item.stable_key));
  const allowedChannels = new Set<string>(channels.map((item) => item.value));
  const keyFor = (attribute: unknown, polarity: unknown, channel: unknown, scope: unknown) =>
    JSON.stringify([attribute, polarity, channel, String(scope ?? "").trim()]);
  const seen = new Set([
    ...previousCandidates.map((item) =>
      keyFor(item.attributeStableKey, item.polarity, item.responseChannel, item.scope),
    ),
    ...retained.preferences.map((item) =>
      keyFor(item.stable_key, item.polarity, item.response_channel, JSON.parse(String(item.context_json)).entryScope),
    ),
  ]);
  const candidates: PreferenceHypothesis[] = [];
  for (const item of result.value.candidates) {
    if (!allowedKeys.has(item.attributeStableKey) || !allowedChannels.has(item.responseChannel))
      throw new Error("HYPOTHESIS_DOMAIN_MISMATCH");
    const key = keyFor(item.attributeStableKey, item.polarity, item.responseChannel, item.scope);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      ...item,
      id: await deriveUuid(env.AUTH_PEPPER, `hypothesis:${refinementId}:${candidates.length}`),
    });
  }
  return { ...result, candidates, inputHash: await sha256Hex(JSON.stringify(messages)) };
}

export async function commitHypothesisPreview(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  attemptId: string,
  baseAnalysisRunId: string,
  candidates: PreferenceHypothesis[],
  metadata: D1PreparedStatement[],
) {
  const now = nowIso(),
    step = `commit-hypotheses:${attemptId}`;
  const guard = repository.guard();
  const results = await env.DB.batch([
    repository.updateJobs(env.DB, [
      step,
      now,
      params.jobId,
      params.ownerUserId,
      params.inputGeneration,
      attemptId,
      params.entryId,
      params.ownerUserId,
      params.inputGeneration,
    ]),
    ...metadata,
    repository.updatePreferenceRefinements(env.DB, guard, [
      JSON.stringify(candidates),
      params.refinementId,
      params.ownerUserId,
      params.jobId,
      params.ownerUserId,
      step,
    ]),
    repository.updateUserCharacterEntries(env.DB, guard, [
      now,
      params.entryId,
      params.ownerUserId,
      params.inputGeneration,
      params.jobId,
      params.ownerUserId,
      step,
    ]),
    repository.updateJobAttempts(env.DB, guard, [now, attemptId, params.jobId, params.jobId, params.ownerUserId, step]),
    repository.updateJobs2(env.DB, [
      JSON.stringify({
        entryId: params.entryId,
        reviewTargetId: baseAnalysisRunId,
        hypothesisBatchId: params.refinementId,
      }),
      now,
      params.jobId,
      params.ownerUserId,
      step,
    ]),
  ]);
  if (
    results.some((result) => !result.success) ||
    !results[0].meta.changes ||
    results.slice(-4).some((result) => !result.meta.changes)
  )
    throw new Error("JOB_COMMIT_FENCE_CHANGED");
}
