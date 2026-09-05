import { first } from "../lib/db";
import { createLlmProvider } from "../llm/providers";
import { llmRoutingSnapshotSchema, resolveLlmRoutingSnapshot } from "../llm/routing";
import type { Env } from "../types";
import { loadMembershipTier } from "./membership";

/** Call before the batch that creates the job and its outbox event. */
export async function newJobLlmRoutingJson(env: Env, ownerUserId: string): Promise<string> {
  return JSON.stringify(resolveLlmRoutingSnapshot(env, await loadMembershipTier(env, ownerUserId)));
}

export async function createJobLlmProvider(env: Env, jobId: string, ownerUserId: string) {
  const job = await first<{ llm_routing_snapshot_json: string | null }>(
    env.DB.prepare(
      "SELECT llm_routing_snapshot_json FROM jobs WHERE id=? AND owner_user_id=? AND job_type IN ('character_analysis','generation')",
    ).bind(jobId, ownerUserId),
  );
  if (!job) throw new Error("LLM_JOB_NOT_FOUND");
  if (!job.llm_routing_snapshot_json) throw new Error("LLM_JOB_ROUTING_REQUIRED");
  const snapshot = llmRoutingSnapshotSchema.parse(JSON.parse(job.llm_routing_snapshot_json));
  return createLlmProvider(env, { snapshot, jobId });
}
