import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { darkResponseChannelValues } from "../../shared/dark-response-channels";
import type { GenerationFeedbackInput } from "../../shared/quality-schemas";
import { responseChannelValues } from "../../shared/response-channels";
import type { AnyGeneratedCharacterCandidate } from "../../shared/schemas";
import { deriveUuid, nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";
import { isCharacterContentPointer } from "./generation-validation";
import { outboxStatement } from "./orchestration";

async function ownedCandidate(env: Env, ownerUserId: string, domain: AnalysisDomain, candidateId: string) {
  const row = await first<{
    id: string;
    generation_request_id: string;
    character_json: string;
    generated_character_id: string;
    generation_brief_id: string;
    model_run_metadata_id: string;
  }>(
    env.DB.prepare(
      `SELECT c.*,gc.id AS generated_character_id FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id JOIN generated_characters gc ON gc.generation_request_id=r.id WHERE c.id=? AND c.owner_user_id=? AND r.analysis_domain=? AND c.status='passed' AND r.status='generated'`,
    ).bind(candidateId, ownerUserId, domain),
  );
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
    env.DB.prepare(
      `UPDATE generation_candidates SET selected_at=NULL WHERE generation_request_id=? AND owner_user_id=?`,
    ).bind(requestId, ownerUserId),
    env.DB.prepare(
      `UPDATE generation_candidates SET selected_at=? WHERE id=? AND owner_user_id=? AND status='passed'`,
    ).bind(now, candidateId, ownerUserId),
    env.DB.prepare(
      `UPDATE generated_characters SET status='accepted',character_json=?,content_hash=?,generation_brief_id=?,model_run_metadata_id=?,updated_at=? WHERE id=? AND owner_user_id=?`,
    ).bind(
      row.character_json,
      await sha256Hex(row.character_json),
      row.generation_brief_id,
      row.model_run_metadata_id,
      now,
      row.generated_character_id,
      ownerUserId,
    ),
    env.DB.prepare(`DELETE FROM generation_basis_links WHERE generated_character_id=?`).bind(
      row.generated_character_id,
    ),
    ...candidate.briefCoverage.flatMap((item) =>
      item.outputPointers.map((pointer) =>
        env.DB.prepare(
          `INSERT INTO generation_basis_links (id,generated_character_id,profile_snapshot_item_id,output_json_pointer,use_type,explanation,created_at) VALUES (?,?,?,?,?,?,?)`,
        ).bind(
          crypto.randomUUID(),
          row.generated_character_id,
          item.profileSnapshotItemId,
          pointer,
          item.treatment === "prohibit" ? "avoided" : item.treatment === "explore" ? "explored" : "realized",
          item.explanation,
          now,
        ),
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
    env.DB.prepare(`SELECT request_hash FROM generation_feedback WHERE id=? AND owner_user_id=?`).bind(id, ownerUserId),
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
    env.DB.prepare(
      `SELECT d.id,d.label FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=?`,
    ).bind(input.attributeStableKey, domain),
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
  await env.DB.prepare(
    `INSERT INTO generation_feedback (id,owner_user_id,analysis_domain,generated_character_id,candidate_id,character_name,output_pointer,output_excerpt,reason,preference_json,status,request_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'proposed',?,?)`,
  )
    .bind(
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
    )
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
  }>(
    env.DB.prepare(
      `SELECT id,character_name,output_pointer,output_excerpt,reason,preference_json,status FROM generation_feedback WHERE owner_user_id=? AND analysis_domain=? ORDER BY created_at DESC,id`,
    ).bind(ownerUserId, domain),
  );
  const attributes = await all<{ stable_key: string; label: string }>(
    env.DB.prepare(
      `SELECT d.stable_key,d.label FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id WHERE d.status='active' AND v.status='active' AND v.analysis_domain=? ORDER BY d.label`,
    ).bind(domain),
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
    env.DB.prepare(`SELECT status FROM generation_feedback WHERE id=? AND owner_user_id=? AND analysis_domain=?`).bind(
      feedbackId,
      ownerUserId,
      domain,
    ),
  );
  if (!row) throw new HTTPException(404, { message: "評価が見つかりません" });
  const status = decision === "confirm" ? "confirmed" : "rejected";
  if (row.status === status) return { status, outboxEventId: null };
  if (row.status !== "proposed") throw new HTTPException(409, { message: "この評価は確認済みです" });
  const now = nowIso();
  const update = env.DB.prepare(
    `UPDATE generation_feedback SET status=?,reviewed_at=? WHERE id=? AND owner_user_id=?`,
  ).bind(status, now, feedbackId, ownerUserId);
  if (decision === "reject") {
    await update.run();
    return { status, outboxEventId: null };
  }
  const state = await first<{ desired_generation: number; built_generation: number }>(
    env.DB.prepare(
      `SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`,
    ).bind(ownerUserId),
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
    env.DB.prepare(
      `INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at) VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at`,
    ).bind(ownerUserId, desiredGeneration, state?.built_generation ?? 0, now),
    env.DB.prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,created_at,updated_at,analysis_domain) VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?,?)`,
    ).bind(jobId, ownerUserId, ownerUserId, desiredGeneration, now, now, domain),
    outbox.statement,
  ]);
  if (results.some((item) => !item.success) || !results[0].meta.changes)
    throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { status, outboxEventId: outbox.id };
}
