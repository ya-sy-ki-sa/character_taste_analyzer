/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function updateJobs(db: D1Database, bindings: readonly [now: unknown, jobId: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET status='running',current_step='compileBrief',progress_current=1,updated_at=?,revision=revision+1 WHERE id=?`,
    )
    .bind(...bindings);
}

export function updateGenerationRequests(
  db: D1Database,
  bindings: readonly [now: unknown, generationRequestId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE generation_requests SET status='draft',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND analysis_domain=?`,
    )
    .bind(...bindings);
}

export function updateJobs2(db: D1Database, bindings: readonly [value0: unknown, jobId: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jobs SET current_step='generateCharacter',progress_current=2,updated_at=?,revision=revision+1 WHERE id=?`,
    )
    .bind(...bindings);
}

export function updateGenerationRequests2(
  db: D1Database,
  bindings: readonly [value0: unknown, generationRequestId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_requests SET status='generating',updated_at=?,revision=revision+1 WHERE id=?`)
    .bind(...bindings);
}

export function insertGenerationCandidates(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    generationRequestId: unknown,
    briefRowId: unknown,
    ordinal: unknown,
    value5: unknown,
    candidateJson: unknown,
    reportJson: unknown,
    similarityJson: unknown,
    value9: unknown,
    modelRunId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_candidates (id,owner_user_id,generation_request_id,generation_brief_id,ordinal,status,character_json,validation_json,similarity_json,created_at,model_run_metadata_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(generation_request_id,ordinal) DO UPDATE SET id=excluded.id,generation_brief_id=excluded.generation_brief_id,status=excluded.status,character_json=excluded.character_json,validation_json=excluded.validation_json,similarity_json=excluded.similarity_json,model_run_metadata_id=excluded.model_run_metadata_id`,
    )
    .bind(...bindings);
}

export function updateJobs3(
  db: D1Database,
  bindings: readonly [
    value0Json: unknown,
    completed: unknown,
    completedAgain: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='succeeded',current_step='complete',progress_current=5,result_ref_json=?,
         updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running' AND input_generation=?`)
    .bind(...bindings);
}

export function insertGeneratedCharacters(
  db: D1Database,
  bindings: readonly [
    characterId: unknown,
    ownerUserId: unknown,
    generationRequestId: unknown,
    briefRowId: unknown,
    value4: unknown,
    outputJson: unknown,
    value6: unknown,
    modelRunId: unknown,
    completed: unknown,
    completedAgain: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO generated_characters
          (id,owner_user_id,generation_request_id,status,generation_brief_id,schema_version,character_json,
           content_hash,model_run_metadata_id,created_at,updated_at)
         SELECT ?,?,?,'generated',?,?,?,?,?,?,?
         WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='succeeded')`)
    .bind(...bindings);
}

export function updateGenerationRequests3(
  db: D1Database,
  bindings: readonly [
    completed: unknown,
    generationRequestId: unknown,
    ownerUserId: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_requests SET status='generated',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='succeeded')`)
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  bindings: readonly [completed: unknown, attemptId: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND job_id=? AND status='running'`)
    .bind(...bindings);
}

export function updateGenerationCandidates(
  db: D1Database,
  bindings: readonly [comparisonJson: unknown, id: unknown],
): D1PreparedStatement {
  return db.prepare(`UPDATE generation_candidates SET comparison_json=? WHERE id=?`).bind(...bindings);
}

export function insertGenerationBasisLinks(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    characterId: unknown,
    profileSnapshotItemId: unknown,
    pointer: unknown,
    value4: unknown,
    explanation: unknown,
    completed: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO generation_basis_links (id,generated_character_id,profile_snapshot_item_id,output_json_pointer,use_type,explanation,created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function updateGenerationRequests4(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    now: unknown,
    generationRequestId: unknown,
    ownerUserId: unknown,
    analysisDomain: unknown,
    jobId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE generation_requests SET status=?,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status!='succeeded')`)
    .bind(...bindings);
}

export function updateJobs4(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    value1: unknown,
    value2: unknown,
    value3: unknown,
    value4: unknown,
    value5: unknown,
    now: unknown,
    value7: unknown,
    jobId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status=?,progress_current=CASE WHEN ? THEN progress_current ELSE 5 END,error_code=?,
         error_detail_safe=?,retryable=?,next_attempt_at=?,updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND status!='succeeded'`)
    .bind(...bindings);
}
