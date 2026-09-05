/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectGenerationRequests(
  db: D1Database,
  bindings: readonly [id: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT gr.id,gr.status,gr.user_constraints_json,j.id AS job_id FROM generation_requests gr LEFT JOIN jobs j ON j.target_type='generation_request' AND j.target_id=gr.id WHERE gr.id=? AND gr.owner_user_id=? AND gr.analysis_domain=?`,
    )
    .bind(...bindings);
}

export function selectProfileSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, profileSnapshotId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT ps.id FROM profile_snapshots ps
      WHERE ps.owner_user_id=? AND ps.id=?
        AND EXISTS (SELECT 1 FROM profile_snapshot_items psi WHERE psi.profile_snapshot_id=ps.id AND psi.analysis_domain=?)
      ORDER BY ps.profile_generation DESC,ps.created_at DESC LIMIT 1
    `)
    .bind(...bindings);
}

export function insertGenerationRequests(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    idAgain: unknown,
    mode: unknown,
    inputJson: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_requests (id,owner_user_id,profile_snapshot_id,mode,status,user_constraints_json,brief_revision,revision,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,'draft',?,0,1,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: unknown,
    ownerUserId: unknown,
    id: unknown,
    idAgain: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
    value7: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,quota_reservation_id,created_at,updated_at,analysis_domain,llm_routing_snapshot_json) VALUES (?,?,'generation','queued','generation_request',?,1,0,5,'compileBrief',1,1,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertGenerationRequestPreferences(
  db: D1Database,
  bindings: readonly [id: unknown, itemId: unknown, value2: unknown, value3: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_request_preferences (generation_request_id,profile_snapshot_item_id,treatment,ordinal) VALUES (?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertGenerationRequestPreferences2(
  db: D1Database,
  bindings: readonly [id: unknown, itemId: unknown, value2: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_request_preferences (generation_request_id,profile_snapshot_item_id,treatment,ordinal) VALUES (?,?,'prohibit',?)`,
    )
    .bind(...bindings);
}
