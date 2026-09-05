/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectGenerationRequests(
  db: D1Database,
  bindings: readonly [requestId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT profile_snapshot_id,mode,user_constraints_json,brief_revision,analysis_domain FROM generation_requests WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}

export function selectProfileSnapshots(
  db: D1Database,
  bindings: readonly [profile_snapshot_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,owner_user_id,profile_generation,content_hash,ontology_version,algorithm_version FROM profile_snapshots WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}

export function selectGenerationRequestPreferences(
  db: D1Database,
  bindings: readonly [requestId: unknown, analysis_domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT psi.id,psi.item_type,psi.stable_key,psi.label,psi.payload_json,grp.treatment
    FROM generation_request_preferences grp JOIN profile_snapshot_items psi ON psi.id=grp.profile_snapshot_item_id
    WHERE grp.generation_request_id=? AND psi.analysis_domain=? ORDER BY grp.ordinal,psi.id
  `)
    .bind(...bindings);
}

export function insertGenerationBriefs(
  db: D1Database,
  bindings: readonly [
    briefRowId: unknown,
    requestId: unknown,
    value2: unknown,
    briefJson: unknown,
    value4: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_briefs (id,generation_request_id,revision_number,schema_version,brief_json,content_hash,validation_status,validation_errors_json,created_at) VALUES (?,?,?,'2.0',?,?,'valid','[]',?)`,
    )
    .bind(...bindings);
}

export function updateGenerationRequests(
  db: D1Database,
  bindings: readonly [now: unknown, requestId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE generation_requests SET status='brief_ready',brief_revision=brief_revision+1,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}
