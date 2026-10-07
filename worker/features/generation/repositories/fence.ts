import type { GenerationFence } from "../types";

/** Every mutable workflow write checks the attempt inside its SQL, including batch members. */
export function generationGuard(
  fence?: GenerationFence,
  attemptStatus: "running" | "succeeded" | "failed" = "running",
) {
  if (!fence) return { sql: "1", bindings: [] as unknown[] };
  return {
    sql: `EXISTS (
      SELECT 1 FROM jobs j WHERE j.id=? AND j.owner_user_id=? AND j.target_id=?
        AND j.analysis_domain=? AND j.input_generation=?
        AND ((? IS NULL AND j.status IN ('queued','retrying','failed')
          AND NOT EXISTS (SELECT 1 FROM job_attempts a WHERE a.job_id=j.id AND a.status='running'))
        OR (j.status='running' AND EXISTS (
          SELECT 1 FROM job_attempts a WHERE a.job_id=j.id AND a.id=? AND a.status=?
            AND NOT EXISTS (SELECT 1 FROM job_attempts newer
              WHERE newer.job_id=j.id AND newer.attempt_number>a.attempt_number)
        )))
    )`,
    bindings: [
      fence.jobId,
      fence.ownerUserId,
      fence.generationRequestId,
      fence.analysisDomain,
      fence.inputGeneration,
      fence.attemptId,
      fence.attemptId,
      attemptStatus,
    ],
  };
}

export function selectCurrentAttempt(db: D1Database, fence: GenerationFence) {
  const guard = generationGuard(fence);
  return db.prepare(`SELECT 1 AS ok WHERE ${guard.sql}`).bind(...guard.bindings);
}
