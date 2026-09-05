/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectSourceSetItems(
  db: D1Database,
  bindings: readonly [entryId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT e.id, e.owner_user_id, e.analysis_domain,e.registration_type, er.id AS revision_id, er.representation_id,
           r.base_representation_id, r.character_identity_id, er.source_set_id,
           er.registration_payload_json,
           (SELECT ssi.source_id FROM source_set_items ssi
            WHERE ssi.source_set_id = er.source_set_id ORDER BY ssi.priority, ssi.source_id LIMIT 1) AS source_id
    FROM user_character_entries e
    JOIN entry_revisions er ON er.entry_id = e.id AND er.revision_number = e.active_revision_number
    JOIN character_representations r ON r.id = er.representation_id
    WHERE e.id = ? AND e.owner_user_id = ? AND e.analysis_domain=?
  `)
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT d.id, d.stable_key, d.label, d.category
    FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id = d.schema_version_id
    WHERE v.status = 'active' AND v.analysis_domain=? AND d.status = 'active' ORDER BY d.stable_key
  `)
    .bind(...bindings);
}
