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
  const read = () =>
    first<{ llm_routing_snapshot_json: string | null }>(
      env.DB.prepare(
        "SELECT llm_routing_snapshot_json FROM jobs WHERE id=? AND owner_user_id=? AND job_type IN ('character_analysis','generation')",
      ).bind(jobId, ownerUserId),
    );
  let job = await read();
  if (!job) throw new Error("LLM_JOB_NOT_FOUND");
  if (job.llm_routing_snapshot_json === null) {
    // An old job must not inherit a subsequently granted tier or tier override.
    const legacy = resolveLlmRoutingSnapshot(env, "basic", true);
    await env.DB.prepare(
      "UPDATE jobs SET llm_routing_snapshot_json=? WHERE id=? AND owner_user_id=? AND llm_routing_snapshot_json IS NULL",
    )
      .bind(JSON.stringify(legacy), jobId, ownerUserId)
      .run();
    // Read the winner if another worker initialized the same legacy job.
    job = await read();
  }
  const snapshot = llmRoutingSnapshotSchema.parse(JSON.parse(job?.llm_routing_snapshot_json ?? "null"));
  return createLlmProvider(env, { snapshot, jobId });
}
