import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GenerationRequestInput } from "../../../shared/contracts/generation";
import { deriveUuid, nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { newJobLlmRoutingJson } from "../../llm/execution";
import { outboxStatement } from "../../platform/outbox/write";
import { prepareQuotaReservation } from "../../platform/quota/reservations";
import type { Env } from "../../types";
import * as repository from "./repositories/request";
import { validateSnapshotItemIds } from "./selections";

export async function createGenerationRequest(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  input: GenerationRequestInput,
  idempotencyKey: string,
) {
  const id = await deriveUuid(env.AUTH_PEPPER, `generation:${ownerUserId}:${idempotencyKey}`);
  const existing = await first<{
    id: string;
    status: string;
    job_id: string | null;
    user_constraints_json: string;
  }>(repository.selectGenerationRequests(env.DB, [id, ownerUserId, analysisDomain]));
  if (existing) {
    if (existing.user_constraints_json !== JSON.stringify(input)) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { generationRequestId: existing.id, status: existing.status, jobId: existing.job_id, replayed: true };
  }
  const snapshot = await first<{ id: string }>(
    repository.selectProfileSnapshots(env.DB, [ownerUserId, input.profileSnapshotId, analysisDomain]),
  );
  if (!snapshot) throw new Error("PROFILE_REQUIRED");
  const allIds = [...new Set([...input.selectedItemIds, ...input.prohibitedItemIds])];
  if (input.selectedItemIds.some((item) => input.prohibitedItemIds.includes(item)))
    throw new Error("GENERATION_SELECTION_CONFLICT");
  if (!(await validateSnapshotItemIds(env, snapshot.id, allIds, analysisDomain)))
    throw new Error("PROFILE_ITEM_NOT_FOUND");
  const now = nowIso();
  const jobId = crypto.randomUUID();
  const requestHash = await sha256Hex(JSON.stringify(input));
  const quota = await prepareQuotaReservation(env, ownerUserId, "generation", idempotencyKey, requestHash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    {
      type: "generation.start",
      params: { jobId, ownerUserId, generationRequestId: id, inputGeneration: 1, analysisDomain },
    },
    `generation:${jobId}:1`,
    idempotencyKey,
  );
  const statements: D1PreparedStatement[] = [
    ...quota.statements,
    repository.insertGenerationRequests(env.DB, [
      id,
      ownerUserId,
      snapshot.id,
      input.mode,
      JSON.stringify(input),
      now,
      now,
      analysisDomain,
    ]),
    repository.insertJobs(env.DB, [
      jobId,
      ownerUserId,
      id,
      quota.id,
      now,
      now,
      analysisDomain,
      await newJobLlmRoutingJson(env, ownerUserId),
    ]),
    outbox.statement,
  ];
  let ordinal = 0;
  for (const itemId of input.selectedItemIds)
    statements.push(
      repository.insertGenerationRequestPreferences(env.DB, [
        id,
        itemId,
        input.mode === "faithful" ? "required" : input.mode === "exploratory" ? "explore" : "include",
        ordinal++,
      ]),
    );
  for (const itemId of input.prohibitedItemIds)
    statements.push(repository.insertGenerationRequestPreferences2(env.DB, [id, itemId, ordinal++]));
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_GENERATION_CREATE_FAILED");
  return { generationRequestId: id, status: "draft", jobId, outboxEventId: outbox.id, replayed: false };
}
