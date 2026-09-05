/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectProfileSnapshots(db: D1Database, bindings: readonly [ownerUserId: unknown]): D1PreparedStatement {
  return db
    .prepare(`
          SELECT ps.id,ps.profile_generation
          FROM profile_snapshots ps JOIN profile_projections pp ON pp.id=ps.profile_projection_id
          WHERE ps.owner_user_id=? AND pp.status='current'
          ORDER BY ps.profile_generation DESC,ps.created_at DESC LIMIT 1
        `)
    .bind(...bindings);
}

export function selectProfileSnapshotItems(
  db: D1Database,
  bindings: readonly [id: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,item_type,stable_key,label,payload_json FROM profile_snapshot_items WHERE profile_snapshot_id=? AND analysis_domain=? ORDER BY ordinal,id`,
    )
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
          SELECT ad.stable_key,ad.label FROM attribute_definitions ad
          JOIN attribute_schema_versions av ON av.id=ad.schema_version_id
          WHERE ad.status='active' AND av.status='active' AND av.analysis_domain=?
        `)
    .bind(...bindings);
}
