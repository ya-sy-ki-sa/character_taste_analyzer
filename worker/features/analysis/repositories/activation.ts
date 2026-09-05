/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [analysisRunId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT e.id AS entry_id,er.revision_number,
        (SELECT id FROM jobs WHERE owner_user_id=e.owner_user_id AND job_type='character_analysis'
          AND target_type='entry' AND target_id=e.id AND input_generation=er.revision_number LIMIT 1) AS job_id
      FROM analysis_runs ar JOIN entry_revisions er ON er.id=ar.entry_revision_id
      JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
      WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=? AND e.status='analysis_review'
        AND ar.status='succeeded'
        AND ar.run_generation=(SELECT MAX(latest.run_generation) FROM analysis_runs latest WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded')
    `)
    .bind(...bindings);
}

export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function updatePreferenceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, analysisDomain: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE preference_assertions SET status='confirmed' WHERE owner_user_id=? AND analysis_domain=? AND analysis_run_id=? AND status='proposed'`,
    )
    .bind(...bindings);
}

export function updateValueStanceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE value_stance_assertions SET status='confirmed' WHERE owner_user_id=? AND analysis_run_id=? AND status='proposed'`,
    )
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: unknown, entry_id: unknown, ownerUserId: unknown, revision_number: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='active', active_generation=active_generation+1, updated_at=?, revision=revision+1
       WHERE id=? AND owner_user_id=? AND active_revision_number=? AND status='analysis_review'`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [value0Json: unknown, now: unknown, nowAgain: unknown, job_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='succeeded',current_step='complete',progress_current=15,result_ref_json=?,
             updated_at=?,completed_at=?,revision=revision+1 WHERE id=? AND status='waiting_for_user'`)
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, desiredGeneration: unknown, value2: unknown, now: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO projection_rebuild_states
        (owner_user_id,desired_generation,built_generation,status,updated_at)
      VALUES (?,?,?,'queued',?)
      ON CONFLICT(owner_user_id) DO UPDATE SET
        desired_generation=excluded.desired_generation,status='queued',last_error_code=NULL,updated_at=excluded.updated_at
    `)
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    profileJobId: unknown,
    ownerUserId: unknown,
    ownerUserIdAgain: unknown,
    desiredGeneration: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs
        (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,
         current_step,retryable,revision,created_at,updated_at,analysis_domain)
       VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?,?)`)
    .bind(...bindings);
}
