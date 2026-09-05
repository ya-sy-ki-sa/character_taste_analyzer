import type { AnalysisDomain } from "../../../../shared/analysis-domain";

/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectLatestRefinement(
  db: D1Database,
  bindings: readonly [ownerUserId: string, entryId: string, analysisDomain: AnalysisDomain],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT f.id FROM preference_refinements f JOIN entry_revisions er ON er.id=f.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number WHERE f.owner_user_id=? AND e.id=? AND e.analysis_domain=? ORDER BY f.created_at DESC,f.rowid DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectRevisionRefinement(
  db: D1Database,
  bindings: readonly [refinementId: string, ownerUserId: string, entryRevisionId: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,mode,answers_json,context_json FROM preference_refinements WHERE id=? AND owner_user_id=? AND entry_revision_id=?`,
    )
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: string, entryRevisionId: string, representationId: string],
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
  bindings: readonly [ownerUserId: string, entryRevisionId: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT pa.polarity,pa.response_channel,pa.context_json,pa.status,rm.raw_label FROM preference_assertions pa JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id WHERE pa.owner_user_id=? AND pa.entry_revision_id=? AND pa.status IN ('rejected','corrected','superseded')`,
    )
    .bind(...bindings);
}

export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [ownerUserId: string, entryRevisionId: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COALESCE(MAX(run_generation),0)+1 AS next_generation FROM analysis_runs WHERE owner_user_id=? AND entry_revision_id=?`,
    )
    .bind(...bindings);
}

export function selectDarkTransformationDeltas(
  db: D1Database,
  bindings: readonly [ownerUserId: string, snapshotId: string],
): D1PreparedStatement {
  return db
    .prepare(`SELECT operation,aspect,before_value,after_value,detail_json,confidence
           FROM dark_transformation_deltas
           WHERE owner_user_id=? AND understanding_snapshot_id=? ORDER BY ordinal,id`)
    .bind(...bindings);
}

export function acquirePreferenceCommitFence(
  db: D1Database,
  bindings: readonly [
    commitStep: string,
    now: string,
    jobId: string,
    ownerUserId: string,
    inputGeneration: number,
    entryId: string,
    ownerUserIdAgain: string,
    inputGenerationAgain: number,
    attemptId: string,
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
    runId: string,
    ownerUserId: string,
    entryRevisionId: string,
    understandingSnapshotId: string,
    runGeneration: number,
    modelRunId: string,
    ontologyVersion: string,
    summaryJson: string,
    uncertaintiesJson: string,
    now: string,
    nowAgain: string,
    nowAgainAgain: string,
    jobId: string,
    ownerUserIdAgain: string,
    commitStep: string,
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
  bindings: readonly [qualityContextJson: string, runId: string],
): D1PreparedStatement {
  return db.prepare(`UPDATE analysis_runs SET quality_context_json=? WHERE id=?`).bind(...bindings);
}

export function insertRawAttributeMentions(
  db: D1Database,
  bindings: readonly [
    rawId: string,
    ownerUserId: string,
    assertionId: string,
    rawLabel: string,
    normalizedLabel: string,
    now: string,
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
    mappingId: string,
    rawId: string,
    attributeDefinitionId: string | null,
    mappingStatus: "accepted" | "unmapped",
    mappingMethod: "exact" | "llm",
    confidence: number,
    now: string,
    decidedAt: string | null,
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
    id: string,
    ownerUserId: string,
    runId: string,
    entryRevisionId: string,
    characterIdentityId: string,
    representationId: string,
    attributeDefinitionId: string | null,
    rawId: string,
    analysisDomain: AnalysisDomain,
    polarity: string,
    responseChannel: string | null,
    strength: number,
    explicitness: string,
    confidence: number,
    contextJson: string,
    now: string,
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

export function insertPreferenceEvidence(
  db: D1Database,
  bindings: readonly [
    evidenceId: string,
    ownerUserId: string,
    assertionId: string,
    sourceId: string | null,
    evidenceOrigin: string,
    quoteStart: number | null,
    quoteEnd: number | null,
    quoteHash: string | null,
    excerptText: string | null,
    inputPointer: string | null,
    confidence: number,
    verificationStatus: string,
    inferenceType: string,
    now: string,
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
    id: string,
    ownerUserId: string,
    runId: string,
    targetType: string,
    targetRef: string,
    stance: string,
    orientation: string,
    contextJson: string,
    explicitness: string,
    confidence: number,
    now: string,
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

export function insertValueStanceEvidence(
  db: D1Database,
  bindings: readonly [
    evidenceId: string,
    ownerUserId: string,
    assertionId: string,
    sourceId: string | null,
    evidenceOrigin: string,
    quoteStart: number | null,
    quoteEnd: number | null,
    quoteHash: string | null,
    excerptText: string | null,
    inputPointer: string | null,
    confidence: number,
    verificationStatus: string,
    inferenceType: string,
    now: string,
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
    now: string,
    entryId: string,
    ownerUserId: string,
    inputGeneration: number,
    jobId: string,
    commitStep: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='analysis_review',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND active_revision_number=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND current_step=? AND status='running')`)
    .bind(...bindings);
}

export function awaitPreferenceReview(
  db: D1Database,
  bindings: readonly [
    resultJson: string,
    now: string,
    jobId: string,
    ownerUserId: string,
    inputGeneration: number,
    commitStep: string,
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
  bindings: readonly [now: string, attemptId: string, jobId: string],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND job_id=? AND status='running'`)
    .bind(...bindings);
}
