/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [runId: unknown, owner: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT pa.*,rm.raw_label,d.stable_key FROM preference_assertions pa LEFT JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id LEFT JOIN attribute_definitions d ON d.id=pa.attribute_definition_id WHERE pa.analysis_run_id=? AND pa.owner_user_id=? AND pa.status NOT IN ('rejected','superseded') AND NOT (EXISTS (SELECT 1 FROM evidence_fragments invalid WHERE invalid.owner_type='preference_assertion' AND invalid.owner_id=pa.id AND invalid.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments valid WHERE valid.owner_type='preference_assertion' AND valid.owner_id=pa.id AND valid.verification_status!='invalid')) ORDER BY pa.created_at,pa.id`,
    )
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [runId: unknown, owner: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT vs.* FROM value_stance_assertions vs WHERE vs.analysis_run_id=? AND vs.owner_user_id=? AND vs.status NOT IN ('rejected','superseded') AND NOT (EXISTS (SELECT 1 FROM evidence_fragments bad WHERE bad.owner_type='value_stance_assertion' AND bad.owner_id=vs.id AND bad.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments good WHERE good.owner_type='value_stance_assertion' AND good.owner_id=vs.id AND good.verification_status!='invalid')) ORDER BY vs.created_at,vs.id`,
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
