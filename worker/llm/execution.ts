import { loadMembershipTier } from "../features/account/membership";
import { first } from "../lib/db";
import type { Env } from "../types";
import { createLlmProvider } from "./providers";
import * as repository from "./repositories/execution";
import { llmRoutingSnapshotSchema, resolveLlmRoutingSnapshot } from "./routing";

/** Call before the batch that creates the job and its outbox event. */
export async function newJobLlmRoutingJson(env: Env, ownerUserId: string): Promise<string> {
  return JSON.stringify(resolveLlmRoutingSnapshot(env, await loadMembershipTier(env, ownerUserId)));
}

export async function createJobLlmProvider(env: Env, jobId: string, ownerUserId: string) {
  const job = await first<{ llm_routing_snapshot_json: string | null }>(
    repository.selectJobs(env.DB, [jobId, ownerUserId]),
  );
  if (!job) throw new Error("LLM_JOB_NOT_FOUND");
  if (!job.llm_routing_snapshot_json) throw new Error("LLM_JOB_ROUTING_REQUIRED");
  const snapshot = llmRoutingSnapshotSchema.parse(JSON.parse(job.llm_routing_snapshot_json));
  return createLlmProvider(env, { snapshot, jobId });
}
