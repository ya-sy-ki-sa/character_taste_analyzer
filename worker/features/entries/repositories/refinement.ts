/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceRefinements(
  db: D1Database,
  bindings: readonly [id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db.prepare(`SELECT request_hash FROM preference_refinements WHERE id=? AND owner_user_id=?`).bind(...bindings);
}

export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [entryId: unknown, ownerUserId: unknown, domain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT er.id AS entry_revision_id,er.source_set_id,er.revision_number,j.id AS job_id,(SELECT ar.id FROM analysis_runs ar WHERE ar.entry_revision_id=er.id AND ar.owner_user_id=e.owner_user_id AND ar.status='succeeded' ORDER BY ar.run_generation DESC LIMIT 1) AS analysis_run_id FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number JOIN jobs j ON j.target_type='entry' AND j.target_id=e.id AND j.input_generation=er.revision_number AND j.owner_user_id=e.owner_user_id WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=? AND e.status='analysis_review' AND j.status='waiting_for_user'`,
    )
    .bind(...bindings);
}

export function selectPreferenceRefinements2(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entry_revision_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,context_json,hypotheses_json FROM preference_refinements WHERE owner_user_id=? AND entry_revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function insertPreferenceRefinements(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    entry_revision_id: unknown,
    value3: unknown,
    answersJson: unknown,
    hash: unknown,
    now: unknown,
    contextJson: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preference_refinements (id,owner_user_id,entry_revision_id,mode,answers_json,request_hash,created_at,context_json) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  guard: string | number,
  bindings: readonly [now: unknown, entryId: unknown, ownerUserId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE user_character_entries SET status='analyzing',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='analysis_review' AND ${guard}`,
    )
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  guard: string | number,
  bindings: readonly [step: unknown, now: unknown, job_id: unknown, ownerUserId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET status='queued',current_step=?,workflow_instance_id=NULL,error_code=NULL,error_detail_safe=NULL,completed_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='waiting_for_user' AND ${guard}`,
    )
    .bind(...bindings);
}

export function insertSources(
  db: D1Database,
  guard: string | number,
  bindings: readonly [
    sourceId: unknown,
    ownerUserId: unknown,
    question: unknown,
    byteLength: unknown,
    value4: unknown,
    value5Json: unknown,
    answer: unknown,
    value7: unknown,
    now: unknown,
    nowAgain: unknown,
    id: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) SELECT ?,?,?,'user_text','{}','user_provided','text/plain',?,?,?,?,?,?,? WHERE ${guard}`,
    )
    .bind(...bindings);
}

export function insertSourceSetItems(
  db: D1Database,
  guard: string | number,
  bindings: readonly [source_set_id: unknown, sourceId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) SELECT ?,?,0,'primary' WHERE ${guard}`,
    )
    .bind(...bindings);
}

export function guard(): string {
  return `EXISTS (SELECT 1 FROM preference_refinements WHERE id=?)`;
}
