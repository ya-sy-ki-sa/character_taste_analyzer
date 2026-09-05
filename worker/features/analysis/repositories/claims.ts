/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [
    jobId: unknown,
    ownerUserId: unknown,
    entryId: unknown,
    inputGeneration: unknown,
    inputGenerationAgain: unknown,
    attemptId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        SELECT 1 AS ok FROM jobs j
        JOIN user_character_entries e ON e.id=j.target_id AND e.owner_user_id=j.owner_user_id
        JOIN job_attempts a ON a.job_id=j.id
        WHERE j.id=? AND j.owner_user_id=? AND j.target_id=? AND j.status='running'
          AND j.input_generation=? AND e.active_revision_number=?
          AND a.id=? AND a.status='running'
      `)
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  bindings: readonly [now: unknown, attemptId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='abandoned',error_code='JOB_SUPERSEDED',finished_at=?,lease_expires_at=NULL
       WHERE id=? AND status='running'`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, jobId: unknown, ownerUserId: unknown, inputGeneration: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='superseded',retryable=0,error_code='JOB_SUPERSEDED',updated_at=?,completed_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND input_generation=? AND status NOT IN ('succeeded','waiting_for_user','cancelled')`)
    .bind(...bindings);
}
