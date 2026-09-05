/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceRefinements(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entryId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT f.id FROM preference_refinements f JOIN entry_revisions er ON er.id=f.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number WHERE f.owner_user_id=? AND e.id=? AND e.analysis_domain=? ORDER BY f.created_at DESC,f.rowid DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectPreferenceRefinements2(
  db: D1Database,
  bindings: readonly [refinementId: unknown, ownerUserId: unknown, entryRevisionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,mode,answers_json,context_json FROM preference_refinements WHERE id=? AND owner_user_id=? AND entry_revision_id=?`,
    )
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entryRevisionId: unknown, representationId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT s.id, s.summary_json, s.source_assessment_json, s.uncertainties_json FROM character_understanding_snapshots s
      JOIN character_understanding_runs r ON r.id = s.understanding_run_id
      WHERE s.owner_user_id = ? AND r.entry_revision_id = ? AND s.representation_id=? AND s.status IN ('confirmed','corrected','provisional_accepted')
      ORDER BY s.created_at DESC LIMIT 1
    `)
    .bind(...bindings);
}

export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entryRevisionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT pa.polarity,pa.response_channel,pa.context_json,pa.status,rm.raw_label FROM preference_assertions pa JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id WHERE pa.owner_user_id=? AND pa.entry_revision_id=? AND pa.status IN ('rejected','corrected','superseded')`,
    )
    .bind(...bindings);
}

export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, entryRevisionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COALESCE(MAX(run_generation),0)+1 AS next_generation FROM analysis_runs WHERE owner_user_id=? AND entry_revision_id=?`,
    )
    .bind(...bindings);
}

export function selectDarkTransformationDeltas(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT operation,aspect,before_value,after_value,detail_json,confidence
           FROM dark_transformation_deltas
           WHERE owner_user_id=? AND understanding_snapshot_id=? ORDER BY ordinal,id`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    commitStep: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    entryId: unknown,
    ownerUserIdAgain: unknown,
    inputGenerationAgain: unknown,
    attemptId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET current_step=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND status='running' AND input_generation=?
         AND EXISTS (
           SELECT 1 FROM user_character_entries e
           WHERE e.id=? AND e.owner_user_id=? AND e.active_revision_number=?
         )
         AND EXISTS (SELECT 1 FROM job_attempts a WHERE a.id=? AND a.job_id=jobs.id AND a.status='running')`)
    .bind(...bindings);
}

export function insertAnalysisRuns(
  db: D1Database,
  bindings: readonly [
    runId: unknown,
    ownerUserId: unknown,
    entryRevisionId: unknown,
    id: unknown,
    runGeneration: unknown,
    idAgain: unknown,
    value6: unknown,
    summaryJson: unknown,
    uncertaintiesJson: unknown,
    now: unknown,
    nowAgain: unknown,
    nowAgainAgain: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
    commitStep: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO analysis_runs
        (id, owner_user_id, entry_revision_id, understanding_snapshot_id, run_generation, status,
         model_run_metadata_id, ontology_version, summary_json, uncertainties_json, revision, started_at, completed_at, created_at)
      SELECT ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, 1, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='running' AND current_step=?)
    `)
    .bind(...bindings);
}

export function updateAnalysisRuns(
  db: D1Database,
  bindings: readonly [value0Json: unknown, runId: unknown],
): D1PreparedStatement {
  return db.prepare(`UPDATE analysis_runs SET quality_context_json=? WHERE id=?`).bind(...bindings);
}

export function insertRawAttributeMentions(
  db: D1Database,
  bindings: readonly [
    rawId: unknown,
    ownerUserId: unknown,
    id: unknown,
    rawLabel: unknown,
    value4: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO raw_attribute_mentions (id, owner_user_id, source_type, source_ref_type, source_ref_id, raw_label, locale, normalized_label, created_at) VALUES (?, ?, 'llm', 'preference_assertion', ?, ?, 'ja', ?, ?)`,
    )
    .bind(...bindings);
}

export function insertAttributeMappings(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    rawId: unknown,
    value2: unknown,
    value3: unknown,
    value4: unknown,
    value5: unknown,
    now: unknown,
    value7: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO attribute_mappings (id, raw_mention_id, attribute_definition_id, mapping_status, mapping_method, confidence, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...bindings);
}

export function insertPreferenceAssertions(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    runId: unknown,
    entryRevisionId: unknown,
    characterIdentityId: unknown,
    representationId: unknown,
    value6: unknown,
    rawId: unknown,
    analysisDomain: unknown,
    polarity: unknown,
    responseChannel: unknown,
    strength: unknown,
    explicitness: unknown,
    value13: unknown,
    contextJson: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO preference_assertions
          (id, owner_user_id, analysis_run_id, entry_revision_id, character_identity_id, representation_id,
           attribute_definition_id, raw_mention_id, analysis_domain, polarity, response_channel, strength, explicitness,
           confidence, context_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
      `)
    .bind(...bindings);
}

export function insertEvidenceFragments(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    id: unknown,
    sourceId: unknown,
    evidenceOrigin: unknown,
    quoteStart: unknown,
    quoteEnd: unknown,
    quoteHash: unknown,
    excerptText: unknown,
    inputPointer: unknown,
    confidence: unknown,
    verificationStatus: unknown,
    inferenceType: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO evidence_fragments
              (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,quote_start,
               quote_end,quote_hash,excerpt_text,user_input_path,confidence,verification_status,inference_type,created_at)
             VALUES (?,?,'preference_assertion',?,?,?,'supports',?,?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function insertValueStanceAssertions(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    runId: unknown,
    targetType: unknown,
    targetRef: unknown,
    stance: unknown,
    orientation: unknown,
    contextJson: unknown,
    explicitness: unknown,
    confidence: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO value_stance_assertions
          (id, owner_user_id, analysis_run_id, target_type, target_ref, stance, orientation, scope_json,
           explicitness, confidence, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
      `)
    .bind(...bindings);
}

export function insertEvidenceFragments2(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    id: unknown,
    sourceId: unknown,
    evidenceOrigin: unknown,
    quoteStart: unknown,
    quoteEnd: unknown,
    quoteHash: unknown,
    excerptText: unknown,
    inputPointer: unknown,
    confidence: unknown,
    verificationStatus: unknown,
    inferenceType: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO evidence_fragments
              (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,quote_start,
               quote_end,quote_hash,excerpt_text,user_input_path,confidence,verification_status,inference_type,created_at)
             VALUES (?,?,'value_stance_assertion',?,?,?,'supports',?,?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [
    now: unknown,
    entryId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    jobId: unknown,
    commitStep: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='analysis_review',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND active_revision_number=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND current_step=? AND status='running')`)
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [
    value0Json: unknown,
    now: unknown,
    jobId: unknown,
    ownerUserId: unknown,
    inputGeneration: unknown,
    commitStep: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='waiting_for_user',current_step='awaitPreferenceReview',progress_current=12,
         result_ref_json=?,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND input_generation=? AND status='running' AND current_step=?`)
    .bind(...bindings);
}

export function updateJobAttempts(
  db: D1Database,
  bindings: readonly [now: unknown, attemptId: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND job_id=? AND status='running'`)
    .bind(...bindings);
}
