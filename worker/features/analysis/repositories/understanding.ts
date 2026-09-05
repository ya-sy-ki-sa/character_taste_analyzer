/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function markUnderstandingStarted(
  db: D1Database,
  bindings: readonly [now: string, jobId: string, ownerUserId: string, inputGeneration: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='running',current_step='understandCharacter',progress_current=2,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running' AND input_generation=?`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: string, entryId: string, ownerUserId: string, inputGeneration: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='understanding',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND active_revision_number=?`)
    .bind(...bindings);
}

export function acquireUnderstandingCommitFence(
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

export function insertDarkBaselineSnapshots(
  db: D1Database,
  bindings: readonly [
    snapshotId: string,
    ownerUserId: string,
    entryRevisionId: string,
    baseRepresentationId: string,
    understandingJson: string,
    contentHash: string,
    modelRunId: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO dark_baseline_snapshots
            (id,owner_user_id,entry_revision_id,representation_id,baseline_json,content_hash,model_run_metadata_id,created_at)
           VALUES (?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: string, representationId: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COALESCE(MAX(snapshot_generation),0)+1 AS next_generation FROM character_understanding_snapshots WHERE owner_user_id=? AND representation_id=?`,
    )
    .bind(...bindings);
}

export function insertCharacterUnderstandingRuns(
  db: D1Database,
  bindings: readonly [
    runId: string,
    ownerUserId: string,
    entryRevisionId: string,
    representationId: string,
    sourceSetId: string | null,
    generation: number,
    modelRunId: string,
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
        INSERT INTO character_understanding_runs
          (id, owner_user_id, entry_revision_id, representation_id, source_set_id, run_generation, status, model_run_metadata_id, revision, started_at, completed_at, created_at)
        SELECT ?, ?, ?, ?, ?, ?, 'succeeded', ?, 1, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='running' AND current_step=?)
      `)
    .bind(...bindings);
}

export function insertCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [
    snapshotId: string,
    ownerUserId: string,
    runId: string,
    representationId: string,
    baseSnapshotId: string | null,
    sourceSetId: string | null,
    snapshotGeneration: number,
    preferenceContext: string | null,
    sourceAssessmentJson: string,
    summaryJson: string,
    uncertaintiesJson: string,
    modelRunId: string,
    ontologyVersion: string,
    contentHash: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO character_understanding_snapshots
          (id, owner_user_id, understanding_run_id, representation_id, base_snapshot_id, source_set_id,
           snapshot_generation, preference_context, status, source_assessment_json, summary_json,
           uncertainties_json, model_run_metadata_id, ontology_version, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?)
      `)
    .bind(...bindings);
}

export function insertRawAttributeMentions(
  db: D1Database,
  bindings: readonly [
    rawId: string,
    ownerUserId: string,
    assertionId: string,
    rawLabel: string,
    valueText: string,
    normalizedLabel: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO raw_attribute_mentions (id, owner_user_id, source_type, source_ref_type, source_ref_id, raw_label, raw_value, locale, normalized_label, created_at) VALUES (?, ?, 'llm', 'character_assertion', ?, ?, ?, 'ja', ?, ?)`,
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

export function insertCharacterAssertions(
  db: D1Database,
  bindings: readonly [
    assertionId: string,
    ownerUserId: string,
    snapshotId: string,
    attributeDefinitionId: string | null,
    rawId: string,
    rawLabel: string,
    valueText: string,
    assertionKind: string,
    scopeJson: string,
    explicitness: string,
    confidence: number,
    ordinal: number,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
          INSERT INTO character_assertions
            (id, owner_user_id, snapshot_id, attribute_definition_id, raw_mention_id, raw_label, value_text,
             assertion_kind, scope_json, explicitness, confidence, status, ordinal, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
        `)
    .bind(...bindings);
}

export function insertEvidenceFragments(
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
    .prepare(`
              INSERT INTO evidence_fragments
                (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,quote_start,
                 quote_end,quote_hash,excerpt_text,user_input_path,confidence,verification_status,inference_type,created_at)
              VALUES (?,?,'character_assertion',?,?,?,'supports',?,?,?,?,?,?,?,?,?)
            `)
    .bind(...bindings);
}

export function insertCustomizationDeltas(
  db: D1Database,
  bindings: readonly [
    deltaId: string,
    ownerUserId: string,
    snapshotId: string,
    operation: string,
    targetAttributeId: string | null,
    beforeValue: string | null,
    afterValue: string | null,
    scopeJson: string,
    reasonText: string | null,
    explicitness: string,
    confidence: number,
    ordinal: number,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
          INSERT INTO customization_deltas
            (id, owner_user_id, snapshot_id, operation, target_attribute_id, before_value, after_value,
             scope_json, reason_text, explicitness, confidence, status, ordinal, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
        `)
    .bind(...bindings);
}

export function insertDarkTransformationDeltas(
  db: D1Database,
  bindings: readonly [
    deltaId: string,
    ownerUserId: string,
    entryRevisionId: string,
    snapshotId: string,
    operation: string,
    aspect: string,
    beforeValue: string | null,
    afterValue: string | null,
    detailJson: string,
    confidence: number,
    ordinal: number,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO dark_transformation_deltas
                (id,owner_user_id,entry_revision_id,understanding_snapshot_id,operation,aspect,before_value,
                 after_value,detail_json,confidence,ordinal,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function markEntryAwaitingUnderstandingReview(
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
    .prepare(`UPDATE user_character_entries SET status='understanding_review',updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND active_revision_number=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND current_step=? AND status='running')`)
    .bind(...bindings);
}

export function awaitUnderstandingReview(
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
    .prepare(`UPDATE jobs SET status='waiting_for_user',current_step='awaitUnderstandingReview',progress_current=8,
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
