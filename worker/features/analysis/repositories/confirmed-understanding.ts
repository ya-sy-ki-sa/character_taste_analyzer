/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectCharacterAssertions(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT a.*,d.stable_key FROM character_assertions a LEFT JOIN attribute_definitions d ON d.id=a.attribute_definition_id WHERE a.snapshot_id=? AND a.owner_user_id=? AND a.status IN ('confirmed','corrected') AND NOT (EXISTS (SELECT 1 FROM evidence_fragments invalid WHERE invalid.owner_type='character_assertion' AND invalid.owner_id=a.id AND invalid.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments valid WHERE valid.owner_type='character_assertion' AND valid.owner_id=a.id AND valid.verification_status!='invalid')) ORDER BY a.ordinal,a.id`,
    )
    .bind(...bindings);
}

export function selectEvidenceFragments(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT e.*,s.citation_json FROM evidence_fragments e LEFT JOIN sources s ON s.id=e.source_id JOIN character_assertions a ON a.id=e.owner_id AND e.owner_type='character_assertion' WHERE a.snapshot_id=? AND e.owner_user_id=? AND e.verification_status!='invalid' ORDER BY e.created_at,e.id`,
    )
    .bind(...bindings);
}

export function selectCustomizationDeltas(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.*,d.stable_key FROM customization_deltas c LEFT JOIN attribute_definitions d ON d.id=c.target_attribute_id WHERE c.snapshot_id=? AND c.owner_user_id=? AND c.status IN ('confirmed','corrected') ORDER BY c.ordinal,c.id`,
    )
    .bind(...bindings);
}

export function selectExcludedAssertions(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT a.raw_label,a.value_text,CASE WHEN a.status IN ('rejected','superseded') THEN a.status ELSE 'unverified' END AS status FROM character_assertions a WHERE a.snapshot_id=? AND a.owner_user_id=? AND (a.status IN ('rejected','superseded') OR (EXISTS (SELECT 1 FROM evidence_fragments invalid WHERE invalid.owner_type='character_assertion' AND invalid.owner_id=a.id AND invalid.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments valid WHERE valid.owner_type='character_assertion' AND valid.owner_id=a.id AND valid.verification_status!='invalid'))) ORDER BY a.ordinal,a.id`,
    )
    .bind(...bindings);
}

export function insertSources(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    byteLength: unknown,
    value3: unknown,
    value4Json: unknown,
    valueText: unknown,
    value6: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,'確認時の訂正','user_text','{}','user_provided','text/plain',?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertSourceSetItems(
  db: D1Database,
  bindings: readonly [sourceSetId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,0,'user_definition')`,
    )
    .bind(...bindings);
}

export function insertEvidenceFragments(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    assertionId: unknown,
    id: unknown,
    valueText: unknown,
    pointer: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO evidence_fragments (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,excerpt_text,user_input_path,verification_status,inference_type,confidence,created_at) VALUES (?,?,'character_assertion',?,?,'review','supports',?,?,'verified_quote','direct',1,?)`,
    )
    .bind(...bindings);
}
