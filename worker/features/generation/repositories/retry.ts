/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [jobId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT status,retryable,target_id,input_generation,analysis_domain FROM jobs
       WHERE id=? AND owner_user_id=? AND job_type='generation' AND target_type='generation_request'`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: unknown, jobId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='queued',current_step='compileBrief',progress_current=0,error_code=NULL,
       error_detail_safe=NULL,result_ref_json=NULL,workflow_instance_id=NULL,next_attempt_at=NULL,
       completed_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='failed' AND retryable=1`)
    .bind(...bindings);
}

export function updateGenerationRequests(
  db: D1Database,
  bindings: readonly [now: unknown, target_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_requests SET status='draft',updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND status='failed'`)
    .bind(...bindings);
}
