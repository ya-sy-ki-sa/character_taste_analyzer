/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceRefinements(
  db: D1Database,
  bindings: readonly [owner: unknown, revisionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT hypotheses_json FROM preference_refinements WHERE owner_user_id=? AND entry_revision_id=? AND hypotheses_json IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 8`,
    )
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    step: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    attemptId: unknown,
    entryId: unknown,
    ownerUserIdAgain: unknown,
    inputGenerationAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET current_step=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='running' AND input_generation=? AND EXISTS (SELECT 1 FROM job_attempts a WHERE a.id=? AND a.job_id=jobs.id AND a.status='running') AND EXISTS (SELECT 1 FROM user_character_entries e WHERE e.id=? AND e.owner_user_id=? AND e.active_revision_number=?)`,
    )
    .bind(...bindings);
}

export function updatePreferenceRefinements(
  db: D1Database,
  guard: string | number,
  bindings: readonly [
    candidatesJson: unknown,
    refinementId: unknown,
    ownerUserId: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
    step: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE preference_refinements SET hypotheses_json=? WHERE id=? AND owner_user_id=? AND ${guard}`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  guard: string | number,
  bindings: readonly [
    now: unknown,
    entryId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
    step: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE user_character_entries SET status='analysis_review',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND active_revision_number=? AND ${guard}`,
    )
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  guard: string | number,
  bindings: readonly [
    now: unknown,
    attemptId: unknown,
    jobId: unknown,
    jobIdAgain: unknown,
    ownerUserId: unknown,
    step: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL WHERE id=? AND job_id=? AND status='running' AND ${guard}`,
    )
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [value0Json: unknown, now: unknown, jobId: unknown, ownerUserId: unknown, step: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET status='waiting_for_user',current_step='awaitPreferenceReview',progress_current=12,result_ref_json=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='running' AND current_step=?`,
    )
    .bind(...bindings);
}

export function guard(): string {
  return `EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='running' AND current_step=?)`;
}
