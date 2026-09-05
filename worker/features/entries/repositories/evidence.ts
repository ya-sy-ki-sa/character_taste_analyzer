/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectEvidenceFragments(
  db: D1Database,
  value1: string | number,
  bindings: readonly unknown[],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT ef.id,ef.owner_id,ef.verification_status,ef.inference_type,ef.excerpt_text,ef.user_input_path,
               sd.title,sd.citation_json
        FROM evidence_fragments ef LEFT JOIN sources sd ON sd.id=ef.source_id
        WHERE ef.owner_user_id=? AND ef.owner_type=? AND ef.owner_id IN (${value1})
        ORDER BY ef.owner_id,ef.id
      `)
    .bind(...bindings);
}
