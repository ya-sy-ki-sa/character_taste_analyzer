export function selectCandidates(
  db: D1Database,
  bindings: readonly [requestId: string, ownerUserId: string, domain: string, briefId: string],
) {
  return db
    .prepare(`SELECT c.ordinal,c.id,c.character_json,c.validation_json,c.model_run_metadata_id,m.prompt_version
    FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id
    JOIN model_run_metadata m ON m.id=c.model_run_metadata_id AND m.owner_user_id=c.owner_user_id
    WHERE c.generation_request_id=? AND c.owner_user_id=? AND r.analysis_domain=?
      AND c.generation_brief_id=? AND c.status='passed' ORDER BY c.ordinal`)
    .bind(...bindings);
}
