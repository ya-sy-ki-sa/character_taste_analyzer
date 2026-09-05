/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function updateJobs(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    value1: unknown,
    value2: unknown,
    code: unknown,
    value4: unknown,
    value5: unknown,
    now: unknown,
    value7: unknown,
    jobId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status=?, progress_current=CASE WHEN ? THEN progress_current ELSE progress_total END,
       retryable=?, error_code=?, error_detail_safe=?,next_attempt_at=?,updated_at=?,completed_at=?,revision=revision+1
       WHERE id=? AND status!='succeeded'`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [value0: unknown, now: unknown, entryId: unknown, ownerUserId: unknown, inputGeneration: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND active_revision_number=?`)
    .bind(...bindings);
}
