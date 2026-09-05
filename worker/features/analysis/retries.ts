import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import * as repository from "./repositories/retries";
import type { CharacterAnalysisRetry } from "./types";

export async function retryCharacterAnalysis(
  env: Env,
  ownerUserId: string,
  jobId: string,
  retryId: string,
): Promise<CharacterAnalysisRetry> {
  const job = await first<{
    id: string;
    status: string;
    retryable: number;
    target_id: string;
    input_generation: number;
    active_revision_number: number;
    has_confirmed_understanding: number;
    analysis_domain: AnalysisDomain;
  }>(repository.selectCharacterUnderstandingSnapshots(env.DB, [jobId, ownerUserId]));
  if (!job) throw new Error("ANALYSIS_JOB_NOT_FOUND");
  if (job.status !== "failed") throw new Error("JOB_NOT_FAILED");
  if (job.retryable !== 1) throw new Error("JOB_NOT_RETRYABLE");
  if (job.input_generation !== job.active_revision_number) throw new Error("JOB_SUPERSEDED");

  const stage: CharacterAnalysisWorkflowParams["stage"] =
    job.has_confirmed_understanding === 1 ? "preference" : "understanding";
  const refinement =
    stage === "preference"
      ? await first<{ id: string }>(
          repository.selectPreferenceRefinements(env.DB, [ownerUserId, job.target_id, job.input_generation]),
        )
      : null;
  const entryStatus = stage === "preference" ? "analyzing" : "submitted";
  const currentStep =
    stage === "preference" ? (refinement ? `preferenceAnalysis:${refinement.id}` : "preferenceAnalysis") : "queued";
  const progressCurrent = stage === "preference" ? 8 : 0;
  const now = nowIso();
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    job.input_generation + 1,
    {
      type: "analysis.start",
      params: {
        jobId,
        ownerUserId,
        entryId: job.target_id,
        ...(refinement ? { refinementId: refinement.id } : {}),
        stage,
        inputGeneration: job.input_generation,
        analysisDomain: job.analysis_domain,
      },
    },
    `retry:${jobId}:${retryId}`,
    retryId,
  );
  const results = await env.DB.batch([
    repository.updateJobs(env.DB, [currentStep, progressCurrent, now, jobId, ownerUserId]),
    repository.updateUserCharacterEntries(env.DB, [entryStatus, now, job.target_id, ownerUserId]),
    outbox.statement,
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1_JOB_RETRY_FAILED");
  if (!results[0].meta.changes) throw new Error("JOB_RETRY_STATE_CHANGED");

  return {
    jobId,
    entryId: job.target_id,
    stage,
    inputGeneration: job.input_generation,
    outboxEventId: outbox.id,
  };
}
