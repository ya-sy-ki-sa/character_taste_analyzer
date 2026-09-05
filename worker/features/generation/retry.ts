import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/retry";

export async function retryGeneration(env: Env, ownerUserId: string, jobId: string, retryId: string) {
  const job = await first<{
    status: string;
    retryable: number;
    target_id: string;
    input_generation: number;
    analysis_domain: AnalysisDomain;
  }>(repository.selectJobs(env.DB, [jobId, ownerUserId]));
  if (!job) throw new Error("GENERATION_JOB_NOT_FOUND");
  if (job.status !== "failed") throw new Error("JOB_NOT_FAILED");
  if (job.retryable !== 1) throw new Error("JOB_NOT_RETRYABLE");
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    job.input_generation + 1,
    {
      type: "generation.start",
      params: {
        jobId,
        ownerUserId,
        generationRequestId: job.target_id,
        inputGeneration: job.input_generation,
        analysisDomain: job.analysis_domain,
      },
    },
    `retry:${jobId}:${retryId}`,
    retryId,
  );
  const now = nowIso();
  const results = await env.DB.batch([
    repository.updateJobs(env.DB, [now, jobId, ownerUserId]),
    repository.updateGenerationRequests(env.DB, [now, job.target_id, ownerUserId]),
    outbox.statement,
  ]);
  if (results.some((result) => !result.success) || !results[0].meta.changes) throw new Error("JOB_RETRY_STATE_CHANGED");
  return {
    jobId,
    generationRequestId: job.target_id,
    inputGeneration: job.input_generation,
    outboxEventId: outbox.id,
  };
}
