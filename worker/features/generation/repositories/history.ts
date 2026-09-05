/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectGenerationRequests(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT gc.id,gr.id AS request_id,gr.status,gr.mode,gr.created_at,gc.character_json,j.status AS job_status,j.error_code
    FROM generation_requests gr LEFT JOIN generated_characters gc ON gc.generation_request_id=gr.id
    LEFT JOIN jobs j ON j.target_type='generation_request' AND j.target_id=gr.id
    WHERE gr.owner_user_id=? AND gr.analysis_domain=?
      AND (gr.status!='generated' OR EXISTS (
        SELECT 1 FROM generation_candidates c WHERE c.generation_request_id=gr.id AND c.status='passed'
      ))
    ORDER BY gr.created_at DESC,gr.id
  `)
    .bind(...bindings);
}

export function selectGenerationCandidates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.* FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id WHERE c.owner_user_id=? AND r.analysis_domain=? AND c.status='passed' AND r.status='generated' ORDER BY c.ordinal`,
    )
    .bind(...bindings);
}
