/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectGenerationCandidates(
  db: D1Database,
  bindings: readonly [candidateId: unknown, ownerUserId: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.*,gc.id AS generated_character_id FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id JOIN generated_characters gc ON gc.generation_request_id=r.id WHERE c.id=? AND c.owner_user_id=? AND r.analysis_domain=? AND c.status='passed' AND r.status='generated'`,
    )
    .bind(...bindings);
}

export function updateGenerationCandidates(
  db: D1Database,
  bindings: readonly [requestId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_candidates SET selected_at=NULL WHERE generation_request_id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function updateGenerationCandidates2(
  db: D1Database,
  bindings: readonly [now: unknown, candidateId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_candidates SET selected_at=? WHERE id=? AND owner_user_id=? AND status='passed'`)
    .bind(...bindings);
}

export function updateGeneratedCharacters(
  db: D1Database,
  bindings: readonly [
    character_json: unknown,
    value1: unknown,
    generation_brief_id: unknown,
    model_run_metadata_id: unknown,
    now: unknown,
    generated_character_id: unknown,
    ownerUserId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE generated_characters SET status='accepted',character_json=?,content_hash=?,generation_brief_id=?,model_run_metadata_id=?,updated_at=? WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}

export function deleteGenerationBasisLinks(
  db: D1Database,
  bindings: readonly [generated_character_id: unknown],
): D1PreparedStatement {
  return db.prepare(`DELETE FROM generation_basis_links WHERE generated_character_id=?`).bind(...bindings);
}

export function insertGenerationBasisLinks(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    generated_character_id: unknown,
    profileSnapshotItemId: unknown,
    pointer: unknown,
    value4: unknown,
    explanation: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_basis_links (id,generated_character_id,profile_snapshot_item_id,output_json_pointer,use_type,explanation,created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function selectGenerationFeedback(
  db: D1Database,
  bindings: readonly [id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db.prepare(`SELECT request_hash FROM generation_feedback WHERE id=? AND owner_user_id=?`).bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [attributeStableKey: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT d.id,d.label FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=?`,
    )
    .bind(...bindings);
}

export function insertGenerationFeedback(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    domain: unknown,
    generated_character_id: unknown,
    candidateId: unknown,
    name: unknown,
    outputPointer: unknown,
    excerptJson: unknown,
    reason: unknown,
    preferenceJson: unknown,
    hash: unknown,
    value11: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_feedback (id,owner_user_id,analysis_domain,generated_character_id,candidate_id,character_name,output_pointer,output_excerpt,reason,preference_json,status,request_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'proposed',?,?)`,
    )
    .bind(...bindings);
}

export function selectGenerationFeedback2(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,character_name,output_pointer,output_excerpt,reason,preference_json,status FROM generation_feedback WHERE owner_user_id=? AND analysis_domain=? ORDER BY created_at DESC,id`,
    )
    .bind(...bindings);
}

export function selectAttributeDefinitions2(db: D1Database, bindings: readonly [domain: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `SELECT d.stable_key,d.label FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id WHERE d.status='active' AND v.status='active' AND v.analysis_domain=? ORDER BY d.label`,
    )
    .bind(...bindings);
}

export function selectGenerationFeedback3(
  db: D1Database,
  bindings: readonly [feedbackId: unknown, ownerUserId: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT status FROM generation_feedback WHERE id=? AND owner_user_id=? AND analysis_domain=?`)
    .bind(...bindings);
}

export function updateGenerationFeedback(
  db: D1Database,
  bindings: readonly [status: unknown, now: unknown, feedbackId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_feedback SET status=?,reviewed_at=? WHERE id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, desiredGeneration: unknown, value2: unknown, now: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at) VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at`,
    )
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: unknown,
    ownerUserId: unknown,
    ownerUserIdAgain: unknown,
    desiredGeneration: unknown,
    now: unknown,
    nowAgain: unknown,
    domain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,created_at,updated_at,analysis_domain) VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?,?)`,
    )
    .bind(...bindings);
}
