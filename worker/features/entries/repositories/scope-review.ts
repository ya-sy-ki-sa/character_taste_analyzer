/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectDarkScopeAssessments(
  db: D1Database,
  bindings: readonly [assessmentId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT e.id AS entry_id,er.revision_number,j.id AS job_id,dsa.status
       FROM dark_scope_assessments dsa
       JOIN entry_revisions er ON er.id=dsa.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
         AND j.input_generation=er.revision_number
       WHERE dsa.id=? AND dsa.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain='dark'
         AND dsa.verdict='out_of_scope'`)
    .bind(...bindings);
}

export function updateDarkScopeAssessments(
  db: D1Database,
  bindings: readonly [now: unknown, assessmentId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE dark_scope_assessments SET status='cancelled',reviewed_at=? WHERE id=? AND owner_user_id=? AND status='proposed'`,
    )
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, entry_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='archived',archived_at=?,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='understanding_review'`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, job_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='cancelled',retryable=0,current_step='cancelled',updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='waiting_for_user'`)
    .bind(...bindings);
}

export function updateDarkScopeAssessments2(
  db: D1Database,
  bindings: readonly [now: unknown, assessmentId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE dark_scope_assessments SET status='overridden',reviewed_at=? WHERE id=? AND owner_user_id=? AND status='proposed'`,
    )
    .bind(...bindings);
}

export function updateUserCharacterEntries2(
  db: D1Database,
  bindings: readonly [now: unknown, entry_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='submitted',updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='understanding_review'`)
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [now: unknown, job_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='queued',current_step='queued',progress_current=0,workflow_instance_id=NULL,
       completed_at=NULL,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='waiting_for_user'`)
    .bind(...bindings);
}
