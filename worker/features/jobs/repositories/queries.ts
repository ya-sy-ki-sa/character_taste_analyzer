/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [jobId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,job_type,status,target_type,target_id,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,created_at,updated_at,completed_at FROM jobs WHERE id=? AND owner_user_id=? AND analysis_domain=?`,
    )
    .bind(...bindings);
}
