import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import { jobClaimDisposition } from "./policy";
import * as repository from "./repositories/execution";

export { isRetryableFailure } from "./policy";

export type JobClaim =
  | { status: "claimed"; attemptId: string; attemptNumber: number; stepAttemptNumber: number }
  | { status: "superseded" | "already_finished" | "not_claimable" | "attempts_exhausted" };

export async function claimJob(
  env: Env,
  jobId: string,
  ownerUserId: string,
  inputGeneration: number,
  stepName: string,
): Promise<JobClaim> {
  const row = await first<{
    status: string;
    input_generation: number;
    job_type: string;
    target_type: string;
    target_id: string;
    active_revision_number: number | null;
  }>(repository.selectJobs(env.DB, [jobId, ownerUserId]));
  if (!row) return { status: "not_claimable" };
  if (row.status === "running") {
    const runningAttempt = await first<{ id: string; lease_expires_at: string | null }>(
      repository.selectJobAttempts(env.DB, [jobId]),
    );
    const now = nowIso();
    if (!runningAttempt?.lease_expires_at || runningAttempt.lease_expires_at > now) return { status: "not_claimable" };
    const recovered = await env.DB.batch([
      repository.updateJobAttempts(env.DB, [now, runningAttempt.id, now]),
      repository.updateJobs(env.DB, [now, jobId, ownerUserId, jobId]),
    ]);
    if (!recovered[0].meta.changes || !recovered[1].meta.changes) return { status: "not_claimable" };
    row.status = "retrying";
  }
  const disposition = jobClaimDisposition({
    status: row.status,
    storedGeneration: row.input_generation,
    requestedGeneration: inputGeneration,
    targetType: row.target_type,
    activeRevisionNumber: row.active_revision_number,
  });
  if (disposition === "already_finished" || disposition === "not_claimable") return { status: disposition };
  if (disposition === "superseded") {
    const now = nowIso();
    await repository.updateJobs2(env.DB, [now, now, jobId]).run();
    return { status: "superseded" };
  }
  const next = await first<{ number: number; step_number: number }>(
    repository.selectJobAttempts2(env.DB, [stepName, jobId]),
  );
  const attemptNumber = next?.number ?? 1;
  const stepAttemptNumber = next?.step_number ?? 1;
  if (stepAttemptNumber > 3) return { status: "attempts_exhausted" };
  const now = nowIso();
  const attemptId = crypto.randomUUID();
  const leaseExpires = new Date(Date.now() + (stepName === "character-generation" ? 90 : 30) * 60_000).toISOString();
  const results = await env.DB.batch([
    repository.insertJobAttempts(env.DB, [
      attemptId,
      jobId,
      attemptNumber,
      attemptId,
      leaseExpires,
      JSON.stringify({ inputGeneration, stepAttemptNumber }),
      stepName,
      now,
      jobId,
      ownerUserId,
      inputGeneration,
      jobId,
    ]),
    repository.updateJobs3(env.DB, [stepName, now, jobId, ownerUserId, inputGeneration, attemptId]),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) return { status: "not_claimable" };
  return { status: "claimed", attemptId, attemptNumber, stepAttemptNumber };
}

export async function finishJobAttempt(
  env: Env,
  attemptId: string,
  status: "succeeded" | "failed" | "abandoned",
  errorCode?: string,
  safeDetail?: string | null,
): Promise<void> {
  await repository
    .updateJobAttempts2(env.DB, [status, errorCode ?? null, safeDetail ?? null, nowIso(), attemptId])
    .run();
}
