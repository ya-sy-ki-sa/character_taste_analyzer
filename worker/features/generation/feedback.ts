import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyGeneratedCharacterCandidate } from "../../../shared/contracts/generation";
import type { GenerationFeedbackInput } from "../../../shared/contracts/generation-feedback";
import { darkResponseChannelValues } from "../../../shared/dark-response-channels";
import { responseChannelValues } from "../../../shared/response-channels";
import { deriveUuid, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/feedback";
import { isCharacterContentPointer } from "./validation";

async function ownedCandidate(env: Env, ownerUserId: string, domain: AnalysisDomain, candidateId: string) {
  const row = await first<{
    id: string;
    generation_request_id: string;
    character_json: string;
    generated_character_id: string;
    generation_brief_id: string;
    model_run_metadata_id: string;
  }>(repository.selectGenerationCandidates(env.DB, [candidateId, ownerUserId, domain]));
  if (!row) throw new HTTPException(404, { message: "候補が見つかりません" });
  return row;
}
export async function selectGenerationCandidate(
  env: Env,
  ownerUserId: string,
  domain: AnalysisDomain,
  requestId: string,
  candidateId: string,
) {
  const row = await ownedCandidate(env, ownerUserId, domain, candidateId);
  if (row.generation_request_id !== requestId) throw new HTTPException(404, { message: "候補が見つかりません" });
  const candidate = JSON.parse(row.character_json) as AnyGeneratedCharacterCandidate;
  const now = nowIso();
  const statements = [
    repository.updateGenerationCandidates(env.DB, [requestId, ownerUserId]),
    repository.updateGenerationCandidates2(env.DB, [now, candidateId, ownerUserId]),
    repository.updateGeneratedCharacters(env.DB, [
      row.character_json,
      await sha256Hex(row.character_json),
      row.generation_brief_id,
      row.model_run_metadata_id,
      now,
      row.generated_character_id,
      ownerUserId,
    ]),
    repository.deleteGenerationBasisLinks(env.DB, [row.generated_character_id]),
    ...candidate.briefCoverage.flatMap((item) =>
      item.outputPointers.map((pointer) =>
        repository.insertGenerationBasisLinks(env.DB, [
          crypto.randomUUID(),
          row.generated_character_id,
          item.profileSnapshotItemId,
          pointer,
          item.treatment === "prohibit" ? "avoided" : item.treatment === "explore" ? "explored" : "realized",
          item.explanation,
          now,
        ]),
      ),
    ),
  ];
  const results = await env.DB.batch(statements);
  if (results.some((item) => !item.success) || !results[1].meta.changes || !results[2].meta.changes)
    throw new Error("GENERATION_COMMIT_FENCE_CHANGED");
  return { candidateId, generatedCharacterId: row.generated_character_id };
}
export async function createGenerationFeedback(
  env: Env,
  ownerUserId: string,
  domain: AnalysisDomain,
  input: GenerationFeedbackInput,
  key: string,
) {
  const id = await deriveUuid(env.AUTH_PEPPER, `feedback:${ownerUserId}:${domain}:${key}`),
    hash = await sha256Hex(JSON.stringify(input));
  const existing = await first<{ request_hash: string }>(
    repository.selectGenerationFeedback(env.DB, [id, ownerUserId]),
  );
  if (existing) {
    if (existing.request_hash !== hash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { id, replayed: true };
  }
  const row = await ownedCandidate(env, ownerUserId, domain, input.candidateId);
  const character = JSON.parse(row.character_json) as AnyGeneratedCharacterCandidate;
  if (!isCharacterContentPointer(character, input.outputPointer))
    throw new HTTPException(422, { message: "評価対象の設定が見つかりません" });
  const channels: readonly string[] = domain === "dark" ? darkResponseChannelValues : responseChannelValues;
  if (!channels.includes(input.responseChannel))
    throw new HTTPException(422, { message: "反応経路が対象領域と一致しません" });
  const attribute = await first<{ id: string; label: string }>(
    repository.selectAttributeDefinitions(env.DB, [input.attributeStableKey, domain]),
  );
  if (!attribute) throw new HTTPException(422, { message: "評価する属性を選択してください" });
  let excerpt: unknown = character;
  for (const token of input.outputPointer.slice(1).split("/"))
    excerpt = (excerpt as Record<string, unknown>)[token.replace(/~1/gu, "/").replace(/~0/gu, "~")];
  const preference = {
    schemaVersion: "2.0",
    sourceCandidateId: input.candidateId,
    attributeId: attribute.id,
    label: attribute.label,
    attributeStableKey: input.attributeStableKey,
    polarity: input.polarity,
    responseChannel: input.responseChannel,
    scope: input.scope,
    explicitness: "user_explicit",
    confidence: 1,
  };
  await repository
    .insertGenerationFeedback(env.DB, [
      id,
      ownerUserId,
      domain,
      row.generated_character_id,
      input.candidateId,
      character.identity.name,
      input.outputPointer,
      JSON.stringify(excerpt),
      input.reason,
      JSON.stringify(preference),
      hash,
      nowIso(),
    ])
    .run();
  return { id, replayed: false };
}
export async function listGenerationFeedback(env: Env, ownerUserId: string, domain: AnalysisDomain) {
  const rows = await all<{
    id: string;
    character_name: string;
    output_pointer: string;
    output_excerpt: string;
    reason: string;
    preference_json: string;
    status: string;
  }>(repository.selectGenerationFeedback2(env.DB, [ownerUserId, domain]));
  const attributes = await all<{ stable_key: string; label: string }>(
    repository.selectAttributeDefinitions2(env.DB, [domain]),
  );
  return {
    feedback: rows.map((row) => ({
      id: row.id,
      characterName: row.character_name,
      outputPointer: row.output_pointer,
      outputExcerpt: JSON.parse(row.output_excerpt),
      reason: row.reason,
      preference: JSON.parse(row.preference_json),
      status: row.status,
    })),
    attributes: attributes.map((item) => ({ stableKey: item.stable_key, label: item.label })),
  };
}
export async function reviewGenerationFeedback(
  env: Env,
  ownerUserId: string,
  domain: AnalysisDomain,
  feedbackId: string,
  decision: "confirm" | "reject",
) {
  const row = await first<{ status: string }>(
    repository.selectGenerationFeedback3(env.DB, [feedbackId, ownerUserId, domain]),
  );
  if (!row) throw new HTTPException(404, { message: "評価が見つかりません" });
  const status = decision === "confirm" ? "confirmed" : "rejected";
  if (row.status === status) return { status, outboxEventId: null };
  if (row.status !== "proposed") throw new HTTPException(409, { message: "この評価は確認済みです" });
  const now = nowIso();
  const update = repository.updateGenerationFeedback(env.DB, [status, now, feedbackId, ownerUserId]);
  if (decision === "reject") {
    await update.run();
    return { status, outboxEventId: null };
  }
  const state = await first<{ desired_generation: number; built_generation: number }>(
    repository.selectProjectionRebuildStates(env.DB, [ownerUserId]),
  );
  const desiredGeneration = (state?.desired_generation ?? 0) + 1,
    jobId = crypto.randomUUID();
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    { type: "profile.rebuild", params: { jobId, ownerUserId, desiredGeneration } },
    `profile:${ownerUserId}:${desiredGeneration}`,
    feedbackId,
  );
  const results = await env.DB.batch([
    update,
    repository.insertProjectionRebuildStates(env.DB, [
      ownerUserId,
      desiredGeneration,
      state?.built_generation ?? 0,
      now,
    ]),
    repository.insertJobs(env.DB, [jobId, ownerUserId, ownerUserId, desiredGeneration, now, now, domain]),
    outbox.statement,
  ]);
  if (results.some((item) => !item.success) || !results[0].meta.changes)
    throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { status, outboxEventId: outbox.id };
}
