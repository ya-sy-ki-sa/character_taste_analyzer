/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT e.id,e.registration_type,e.status,e.active_revision_number,e.updated_at,er.registration_payload_json,
      CASE WHEN e.status='understanding_review' THEN (SELECT id FROM character_understanding_snapshots WHERE owner_user_id=e.owner_user_id AND representation_id=er.representation_id ORDER BY created_at DESC LIMIT 1)
           WHEN e.status='analysis_review' THEN (SELECT id FROM analysis_runs WHERE owner_user_id=e.owner_user_id AND entry_revision_id=er.id ORDER BY created_at DESC LIMIT 1)
           ELSE NULL END AS review_target_id,
      j.id AS job_id,j.status AS job_status,j.retryable,j.current_step,j.progress_current,j.progress_total,
      j.error_code,j.error_detail_safe
    FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    LEFT JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id AND j.input_generation=e.active_revision_number
    WHERE e.owner_user_id=? AND e.analysis_domain=? AND e.status<>'archived'
    ORDER BY e.updated_at DESC,e.id
  `)
    .bind(...bindings);
}
