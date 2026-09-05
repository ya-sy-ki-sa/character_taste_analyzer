import { nowIso } from "../lib/crypto";
import { first } from "../lib/db";
import type { Env } from "../types";
import { jobClaimDisposition } from "./job-policy";

export { isRetryableFailure } from "./job-policy";

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
  }>(
    env.DB.prepare(`
      SELECT j.status,j.input_generation,j.job_type,j.target_type,j.target_id,e.active_revision_number
      FROM jobs j LEFT JOIN user_character_entries e
        ON j.target_type='entry' AND e.id=j.target_id AND e.owner_user_id=j.owner_user_id
      WHERE j.id=? AND j.owner_user_id=?
    `).bind(jobId, ownerUserId),
  );
  if (!row) return { status: "not_claimable" };
  if (row.status === "running") {
    const runningAttempt = await first<{ id: string; lease_expires_at: string | null }>(
      env.DB.prepare(
        `SELECT id,lease_expires_at FROM job_attempts
         WHERE job_id=? AND status='running' ORDER BY attempt_number DESC LIMIT 1`,
      ).bind(jobId),
    );
    const now = nowIso();
    if (!runningAttempt?.lease_expires_at || runningAttempt.lease_expires_at > now) return { status: "not_claimable" };
    const recovered = await env.DB.batch([
      env.DB.prepare(
        `UPDATE job_attempts SET status='abandoned',error_code='LEASE_EXPIRED',
         error_detail_safe='前回の実行leaseが期限切れになりました',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND status='running' AND lease_expires_at<=?`,
      ).bind(now, runningAttempt.id, now),
      env.DB.prepare(
        `UPDATE jobs SET status='retrying',retryable=1,current_step='lease-recovery',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running'
           AND NOT EXISTS (SELECT 1 FROM job_attempts WHERE job_id=? AND status='running')`,
      ).bind(now, jobId, ownerUserId, jobId),
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
    await env.DB.prepare(
      `UPDATE jobs SET status='superseded',retryable=0,error_code='JOB_SUPERSEDED',updated_at=?,completed_at=?,revision=revision+1
       WHERE id=? AND status NOT IN ('succeeded','cancelled')`,
    )
      .bind(now, now, jobId)
      .run();
    return { status: "superseded" };
  }
  const next = await first<{ number: number; step_number: number }>(
    env.DB.prepare(
      `SELECT COALESCE(MAX(attempt_number),0)+1 AS number,
        COALESCE(SUM(CASE WHEN step_name=? THEN 1 ELSE 0 END),0)+1 AS step_number
       FROM job_attempts WHERE job_id=?`,
    ).bind(stepName, jobId),
  );
  const attemptNumber = next?.number ?? 1;
  const stepAttemptNumber = next?.step_number ?? 1;
  if (stepAttemptNumber > 3) return { status: "attempts_exhausted" };
  const now = nowIso();
  const attemptId = crypto.randomUUID();
  const leaseExpires = new Date(Date.now() + (stepName === "character-generation" ? 90 : 30) * 60_000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO job_attempts
        (id,job_id,attempt_number,status,lease_owner,lease_expires_at,checkpoint_json,step_name,started_at)
       SELECT ?,?,?,'running',?,?,? ,?,?
       WHERE EXISTS (
         SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND input_generation=?
           AND status IN ('queued','retrying','failed') AND (status!='failed' OR retryable=1)
       ) AND NOT EXISTS (SELECT 1 FROM job_attempts WHERE job_id=? AND status='running')`,
    ).bind(
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
    ),
    env.DB.prepare(
      `UPDATE jobs SET status='running',current_step=?,error_code=NULL,error_detail_safe=NULL,
       updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND input_generation=? AND status IN ('queued','retrying','failed')
         AND (status!='failed' OR retryable=1)
         AND EXISTS (SELECT 1 FROM job_attempts WHERE id=? AND status='running')`,
    ).bind(stepName, now, jobId, ownerUserId, inputGeneration, attemptId),
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
  await env.DB.prepare(
    `UPDATE job_attempts SET status=?,error_code=?,error_detail_safe=?,finished_at=?,lease_expires_at=NULL
     WHERE id=? AND status='running'`,
  )
    .bind(status, errorCode ?? null, safeDetail ?? null, nowIso(), attemptId)
    .run();
}
