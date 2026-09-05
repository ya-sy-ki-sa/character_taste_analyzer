/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, entryId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='archived',archived_at=?,updated_at=?,revision=revision+1
           WHERE id=? AND owner_user_id=? AND analysis_domain=? AND status IN ('active','failed')`)
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, desiredGeneration: unknown, value2: unknown, now: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
          INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
          VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
            desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
        `)
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: unknown,
    ownerUserId: unknown,
    ownerUserIdAgain: unknown,
    desiredGeneration: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
           progress_total,current_step,retryable,revision,created_at,updated_at,analysis_domain)
           VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?,?)`)
    .bind(...bindings);
}
