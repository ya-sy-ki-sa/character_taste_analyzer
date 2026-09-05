/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectCharacterAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT s.id,(SELECT json_group_array(value_text) FROM (SELECT value_text FROM character_assertions a WHERE a.snapshot_id=s.id AND a.owner_user_id=s.owner_user_id AND a.status IN ('confirmed','corrected') ORDER BY a.ordinal,a.id)) AS summary_json,CASE WHEN s.representation_id=er.representation_id THEN json_extract(er.registration_payload_json,'$.characterName') ELSE COALESCE(json_extract(er.registration_payload_json,'$.baseCharacterName'),json_extract(er.registration_payload_json,'$.characterName')) END AS character_name FROM character_understanding_snapshots s JOIN character_understanding_runs r ON r.id=s.understanding_run_id JOIN entry_revisions er ON er.id=r.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number WHERE s.owner_user_id=? AND e.analysis_domain=? AND e.status!='archived' AND s.status IN ('confirmed','corrected','provisional_accepted')`,
    )
    .bind(...bindings);
}

export function selectGeneratedCharacters(
  db: D1Database,
  bindings: readonly [
    ownerUserId: unknown,
    domain: unknown,
    requestId: unknown,
    ownerUserIdAgain: unknown,
    domainAgain: unknown,
    requestIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.id,c.character_json FROM generated_characters c JOIN generation_requests r ON r.id=c.generation_request_id WHERE c.owner_user_id=? AND r.analysis_domain=? AND r.id!=? UNION ALL SELECT c.id,c.character_json FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id WHERE c.owner_user_id=? AND r.analysis_domain=? AND r.id!=? AND c.status='passed'`,
    )
    .bind(...bindings);
}

export function selectCharacterSimilarityDocuments(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, id: unknown, hash: unknown, value3: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT vector_json FROM character_similarity_documents WHERE owner_user_id=? AND source_ref=? AND content_hash=? AND model=?`,
    )
    .bind(...bindings);
}

export function insertCharacterSimilarityDocuments(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    id: unknown,
    hash: unknown,
    value4: unknown,
    value5Json: unknown,
    value6: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO character_similarity_documents (id,owner_user_id,source_ref,content_hash,model,vector_json,created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}
