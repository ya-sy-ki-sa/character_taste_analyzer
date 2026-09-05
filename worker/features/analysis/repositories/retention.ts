/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [runId: unknown, owner: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT pa.*,rm.raw_label,d.stable_key FROM preference_assertions pa LEFT JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id LEFT JOIN attribute_definitions d ON d.id=pa.attribute_definition_id WHERE pa.analysis_run_id=? AND pa.owner_user_id=? AND pa.status NOT IN ('rejected','superseded') ORDER BY pa.created_at,pa.id`,
    )
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [runId: unknown, owner: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT * FROM value_stance_assertions WHERE analysis_run_id=? AND owner_user_id=? AND status NOT IN ('rejected','superseded') ORDER BY created_at,id`,
    )
    .bind(...bindings);
}

export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [runId: unknown, owner: unknown],
): D1PreparedStatement {
  return db.prepare(`SELECT summary_json FROM analysis_runs WHERE id=? AND owner_user_id=?`).bind(...bindings);
}

export function prepareQuery(
  db: D1Database,
  table: string | number,
  value2: string | number,
  value3: string | number,
  bindings: readonly unknown[],
): D1PreparedStatement {
  return db.prepare(`INSERT INTO ${table} (${value2}) VALUES (${value3})`).bind(...bindings);
}

export function selectRawAttributeMentions(
  db: D1Database,
  bindings: readonly [raw_mention_id: unknown, owner: unknown],
): D1PreparedStatement {
  return db.prepare(`SELECT * FROM raw_attribute_mentions WHERE id=? AND owner_user_id=?`).bind(...bindings);
}

export function selectAttributeMappings(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db.prepare(`SELECT * FROM attribute_mappings WHERE raw_mention_id=?`).bind(...bindings);
}

export function selectEvidenceFragments(
  db: D1Database,
  bindings: readonly [owner: unknown, type: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT * FROM evidence_fragments WHERE owner_user_id=? AND owner_type=? AND owner_id=?`)
    .bind(...bindings);
}
