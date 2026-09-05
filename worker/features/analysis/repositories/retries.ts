/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [jobId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT j.id,j.status,j.retryable,j.target_id,j.input_generation,j.analysis_domain,e.active_revision_number,
        EXISTS (
          SELECT 1 FROM character_understanding_snapshots s
          JOIN character_understanding_runs r ON r.id=s.understanding_run_id
          JOIN entry_revisions er ON er.id=r.entry_revision_id
          WHERE er.entry_id=e.id AND er.revision_number=e.active_revision_number
            AND s.owner_user_id=j.owner_user_id
            AND s.status IN ('confirmed','corrected','provisional_accepted')
        ) AS has_confirmed_understanding
      FROM jobs j
      JOIN user_character_entries e ON e.id=j.target_id AND e.owner_user_id=j.owner_user_id
      WHERE j.id=? AND j.owner_user_id=? AND j.job_type='character_analysis'
        AND j.target_type='entry'
    `)
    .bind(...bindings);
}

export function selectPreferenceRefinements(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, target_id: unknown, input_generation: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT f.id FROM preference_refinements f JOIN entry_revisions er ON er.id=f.entry_revision_id WHERE f.owner_user_id=? AND er.entry_id=? AND er.revision_number=? ORDER BY f.created_at DESC,f.rowid DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    currentStep: unknown,
    progressCurrent: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='queued',current_step=?,progress_current=?,error_code=NULL,error_detail_safe=NULL,
        result_ref_json=NULL,workflow_instance_id=NULL,next_attempt_at=NULL,completed_at=NULL,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND status='failed' AND retryable=1`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [entryStatus: unknown, now: unknown, target_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=?`)
    .bind(...bindings);
}
