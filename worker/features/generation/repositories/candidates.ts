/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function insertGenerationValidationRuns(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    generationRequestId: unknown,
    stage: unknown,
    candidateHash: unknown,
    value5: unknown,
    reportJson: unknown,
    value7: unknown,
    value8: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO generation_validation_runs
      (id,owner_user_id,generation_request_id,stage,candidate_hash,status,report_json,model_run_metadata_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(generation_request_id,stage) DO UPDATE SET candidate_hash=excluded.candidate_hash,
       status=excluded.status,report_json=excluded.report_json,model_run_metadata_id=excluded.model_run_metadata_id,
       created_at=excluded.created_at`)
    .bind(...bindings);
}

export function updateJobs(db: D1Database, bindings: readonly [value0: unknown, jobId: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET current_step='repairCharacter',progress_current=4,updated_at=?,revision=revision+1 WHERE id=?`,
    )
    .bind(...bindings);
}
