/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectDarkScopeAssessments(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entryRevisionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT status FROM dark_scope_assessments
       WHERE owner_user_id=? AND entry_revision_id=? LIMIT 1`)
    .bind(...bindings);
}

export function insertDarkScopeAssessments(
  db: D1Database,
  bindings: readonly [
    assessmentId: unknown,
    ownerUserId: unknown,
    entryRevisionId: unknown,
    verdict: unknown,
    value4: unknown,
    valueJson: unknown,
    id: unknown,
    now: unknown,
    value8: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO dark_scope_assessments
        (id,owner_user_id,entry_revision_id,verdict,status,assessment_json,model_run_metadata_id,created_at,reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: unknown, entryId: unknown, ownerUserId: unknown, inputGeneration: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='understanding_review',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND active_revision_number=?`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    value0Json: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='waiting_for_user',current_step='awaitDarkScopeReview',progress_current=3,
         result_ref_json=?,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='running' AND input_generation=?`)
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  bindings: readonly [now: unknown, attemptId: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND job_id=? AND status='running'`)
    .bind(...bindings);
}
