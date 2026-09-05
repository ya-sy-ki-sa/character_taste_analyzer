/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectSourceSetItems(db: D1Database, bindings: readonly [sourceSetId: unknown]): D1PreparedStatement {
  return db
    .prepare(`
      SELECT s.id,s.locator_json,s.text_content,s.source_type,s.citation_json FROM source_set_items ssi
      JOIN sources s ON s.id=ssi.source_id
      WHERE ssi.source_set_id=?
        AND (NOT EXISTS (
          SELECT 1 FROM evidence_fragments e WHERE e.source_id=s.id AND e.evidence_origin='review'
        ) OR EXISTS (
          SELECT 1 FROM evidence_fragments e JOIN character_assertions a
            ON e.owner_type='character_assertion' AND a.id=e.owner_id AND a.owner_user_id=s.owner_user_id
          WHERE e.source_id=s.id AND e.evidence_origin='review' AND a.status IN ('confirmed','corrected')
        ))
      ORDER BY ssi.priority,s.id
    `)
    .bind(...bindings);
}

export function selectSources(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, url: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
        SELECT id AS source_id,citation_json,text_content
        FROM sources
        WHERE owner_user_id=? AND json_extract(citation_json,'$.url')=? LIMIT 1
      `)
    .bind(...bindings);
}

export function updateSources(
  db: D1Database,
  bindings: readonly [updatedCitationJson: unknown, now: unknown, source_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE sources SET citation_json=?,updated_at=?
               WHERE id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function insertSourceSetItems(
  db: D1Database,
  bindings: readonly [sourceSetId: unknown, source_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO source_set_items
              (source_set_id,source_id,priority,usage_type)
             VALUES (?,?,100,'supporting')`)
    .bind(...bindings);
}

export function insertSources(
  db: D1Database,
  bindings: readonly [
    documentId: unknown,
    ownerUserId: unknown,
    title: unknown,
    value3Json: unknown,
    byteLength: unknown,
    hash: unknown,
    value6Json: unknown,
    text: unknown,
    value8: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO sources
          (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,
           locator_json,text_content,token_estimate,created_at,updated_at)
         VALUES (?,?,?,'secondary',?,'public_web_excerpt','text/plain',?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function insertSourceSetItems2(
  db: D1Database,
  bindings: readonly [sourceSetId: unknown, documentId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO source_set_items (source_set_id,source_id,priority,usage_type)
           VALUES (?,?,100,'supporting')`)
    .bind(...bindings);
}
