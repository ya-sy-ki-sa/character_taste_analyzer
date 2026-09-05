/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [jobId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT j.status,j.input_generation,j.job_type,j.target_type,j.target_id,e.active_revision_number
      FROM jobs j LEFT JOIN user_character_entries e
        ON j.target_type='entry' AND e.id=j.target_id AND e.owner_user_id=j.owner_user_id
      WHERE j.id=? AND j.owner_user_id=?
    `)
    .bind(...bindings);
}

export function selectJobAttempts(db: D1Database, bindings: readonly [jobId: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT id,lease_expires_at FROM job_attempts
         WHERE job_id=? AND status='running' ORDER BY attempt_number DESC LIMIT 1`)
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  bindings: readonly [now: unknown, id: unknown, nowAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='abandoned',error_code='LEASE_EXPIRED',
         error_detail_safe='前回の実行leaseが期限切れになりました',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND status='running' AND lease_expires_at<=?`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: unknown, jobId: unknown, ownerUserId: unknown, jobIdAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='retrying',retryable=1,current_step='lease-recovery',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running'
           AND NOT EXISTS (SELECT 1 FROM job_attempts WHERE job_id=? AND status='running')`)
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='superseded',retryable=0,error_code='JOB_SUPERSEDED',updated_at=?,completed_at=?,revision=revision+1
       WHERE id=? AND status NOT IN ('succeeded','cancelled')`)
    .bind(...bindings);
}

export function selectJobAttempts2(
  db: D1Database,
  bindings: readonly [stepName: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT COALESCE(MAX(attempt_number),0)+1 AS number,
        COALESCE(SUM(CASE WHEN step_name=? THEN 1 ELSE 0 END),0)+1 AS step_number
       FROM job_attempts WHERE job_id=?`)
    .bind(...bindings);
}

export function insertJobAttempts(
  db: D1Database,
  bindings: readonly [
    attemptId: unknown,
    jobId: unknown,
    attemptNumber: unknown,
    attemptIdAgain: unknown,
    leaseExpires: unknown,
    value5Json: unknown,
    stepName: unknown,
    now: unknown,
    jobIdAgain: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    jobIdAgainAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO job_attempts
        (id,job_id,attempt_number,status,lease_owner,lease_expires_at,checkpoint_json,step_name,started_at)
       SELECT ?,?,?,'running',?,?,? ,?,?
       WHERE EXISTS (
         SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND input_generation=?
           AND status IN ('queued','retrying','failed') AND (status!='failed' OR retryable=1)
       ) AND NOT EXISTS (SELECT 1 FROM job_attempts WHERE job_id=? AND status='running')`)
    .bind(...bindings);
}

export function updateJobs3(
  db: D1Database,
  bindings: readonly [
    stepName: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    attemptId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='running',current_step=?,error_code=NULL,error_detail_safe=NULL,
       updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND input_generation=? AND status IN ('queued','retrying','failed')
         AND (status!='failed' OR retryable=1)
         AND EXISTS (SELECT 1 FROM job_attempts WHERE id=? AND status='running')`)
    .bind(...bindings);
}

export function updateJobAttempts2(
  db: D1Database,
  bindings: readonly [status: unknown, value1: unknown, value2: unknown, value3: unknown, attemptId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status=?,error_code=?,error_detail_safe=?,finished_at=?,lease_expires_at=NULL
     WHERE id=? AND status='running'`)
    .bind(...bindings);
}
