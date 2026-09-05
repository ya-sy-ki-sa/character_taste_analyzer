/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUnderstandingReviews(
  db: D1Database,
  bindings: readonly [reviewId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT correction_payload_json FROM understanding_reviews WHERE id=? AND owner_user_id=? AND snapshot_id=?`,
    )
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT s.id,er.source_set_id FROM character_understanding_snapshots s
      JOIN character_understanding_runs ur ON ur.id=s.understanding_run_id
      JOIN entry_revisions er ON er.id=ur.entry_revision_id
      JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
      WHERE s.id=? AND s.owner_user_id=? AND e.owner_user_id=?
        AND e.analysis_domain=? AND e.status='understanding_review' AND s.status IN ('proposed','needs_review')
    `)
    .bind(...bindings);
}

export function selectUnderstandingReviews2(
  db: D1Database,
  bindings: readonly [snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT COALESCE(MAX(review_generation),0)+1 AS value FROM understanding_reviews WHERE snapshot_id=?`)
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [assertionAttributeKey: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT d.id FROM attribute_definitions d
           JOIN attribute_schema_versions v ON v.id=d.schema_version_id
           WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=? LIMIT 1`)
    .bind(...bindings);
}

export function insertRawAttributeMentions(
  db: D1Database,
  bindings: readonly [
    correctedRawId: unknown,
    ownerUserId: unknown,
    changedId: unknown,
    rawLabel: unknown,
    valueText: unknown,
    value5: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,raw_value,locale,normalized_label,created_at)
         VALUES (?,?,'user','character_assertion',?,?,?,'ja',?,?)`)
    .bind(...bindings);
}

export function insertAttributeMappings(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    correctedRawId: unknown,
    value2: unknown,
    value3: unknown,
    ownerUserId: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO attribute_mappings
          (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
         VALUES (?,?,?,?, 'user',1,?,?,?)`)
    .bind(...bindings);
}

export function insertCharacterAssertions(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    value3: unknown,
    correctedRawId: unknown,
    rawLabel: unknown,
    valueText: unknown,
    value7Json: unknown,
    snapshotIdAgain: unknown,
    now: unknown,
    snapshotIdAgainAgain: unknown,
    ownerUserIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO character_assertions
          (id,owner_user_id,snapshot_id,attribute_definition_id,raw_mention_id,raw_label,value_text,
           assertion_kind,scope_json,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,?,?,?,?,?,?,'user_interpretation',?,'user_explicit',1,'corrected',
               COALESCE((SELECT MAX(ordinal)+1 FROM character_assertions WHERE snapshot_id=?),0),?
        FROM character_understanding_snapshots s
        WHERE s.id=? AND s.owner_user_id=? AND s.status IN ('proposed','needs_review')
      `)
    .bind(...bindings);
}

export function insertUnderstandingReviews(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    changedId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    changedIdAgain: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?, 'character_assertion',?,'correct',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=?
      `)
    .bind(...bindings);
}

export function selectCharacterAssertions(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT raw_label,value_text,raw_mention_id FROM character_assertions
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function updateAttributeMappings(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, now: unknown, raw_mention_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE attribute_mappings SET mapping_status='rejected',decided_by_user_id=?,decided_at=?
               WHERE raw_mention_id=? AND mapping_status IN ('candidate','accepted','unmapped')`)
    .bind(...bindings);
}

export function insertRawAttributeMentions2(
  db: D1Database,
  bindings: readonly [
    correctedRawId: unknown,
    ownerUserId: unknown,
    changedId: unknown,
    rawLabel: unknown,
    valueText: unknown,
    value5: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,raw_value,locale,normalized_label,created_at)
         VALUES (?,?,'user','character_assertion',?,?,?,'ja',?,?)`)
    .bind(...bindings);
}

export function insertAttributeMappings2(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    correctedRawId: unknown,
    value2: unknown,
    value3: unknown,
    ownerUserId: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO attribute_mappings
          (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
         VALUES (?,?,?,?, 'user',1,?,?,?)`)
    .bind(...bindings);
}

export function insertCharacterAssertions2(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    value1: unknown,
    correctedRawId: unknown,
    rawLabel: unknown,
    valueText: unknown,
    now: unknown,
    targetId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO character_assertions
          (id,owner_user_id,snapshot_id,attribute_definition_id,raw_mention_id,raw_label,value_text,
           assertion_kind,scope_json,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,owner_user_id,snapshot_id,?,?,?,?,'user_interpretation',scope_json,
               'user_explicit',1,'corrected',ordinal,?
        FROM character_assertions
        WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')
      `)
    .bind(...bindings);
}

export function updateCharacterAssertions(
  db: D1Database,
  bindings: readonly [changedId: unknown, targetId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE character_assertions SET status='superseded',superseded_by_id=?
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function insertUnderstandingReviews2(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    targetId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    changedId: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'character_assertion',?,'correct',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='corrected'
      `)
    .bind(...bindings);
}

export function updateCharacterAssertions2(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE character_assertions SET status='rejected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function insertUnderstandingReviews3(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    targetId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    targetIdAgain: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'character_assertion',?,'reject',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='rejected'
      `)
    .bind(...bindings);
}

export function insertCustomizationDeltas(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    operation: unknown,
    beforeValue: unknown,
    afterValue: unknown,
    value6Json: unknown,
    reasonText: unknown,
    snapshotIdAgain: unknown,
    now: unknown,
    snapshotIdAgainAgain: unknown,
    ownerUserIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO customization_deltas
          (id,owner_user_id,snapshot_id,base_assertion_id,operation,target_attribute_id,before_value,after_value,
           scope_json,reason_text,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,?,?,NULL,?,NULL,?,?,?,?,'user_explicit',1,'corrected',
               COALESCE((SELECT MAX(ordinal)+1 FROM customization_deltas WHERE snapshot_id=?),0),?
        FROM character_understanding_snapshots s
        WHERE s.id=? AND s.owner_user_id=? AND s.status IN ('proposed','needs_review')
      `)
    .bind(...bindings);
}

export function insertUnderstandingReviews4(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    changedId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    changedIdAgain: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'correct',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=?
      `)
    .bind(...bindings);
}

export function selectCustomizationDeltas(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT base_assertion_id,operation,before_value,after_value,reason_text FROM customization_deltas
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function updateCustomizationDeltas(
  db: D1Database,
  bindings: readonly [
    operation: unknown,
    beforeValue: unknown,
    afterValue: unknown,
    reasonText: unknown,
    targetId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE customization_deltas
         SET operation=?,before_value=?,after_value=?,reason_text=?,explicitness='user_explicit',confidence=1,status='corrected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function insertUnderstandingReviews5(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    targetId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    targetIdAgain: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'correct',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='corrected'
      `)
    .bind(...bindings);
}

export function updateCustomizationDeltas2(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE customization_deltas SET status='rejected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function insertUnderstandingReviews6(
  db: D1Database,
  bindings: readonly [
    reviewId: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    targetId: unknown,
    correction: unknown,
    reviewGeneration: unknown,
    now: unknown,
    targetIdAgain: unknown,
    ownerUserIdAgain: unknown,
    snapshotIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'reject',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='rejected'
      `)
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots2(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT s.id,s.base_snapshot_id,e.id AS entry_id,er.revision_number,j.id AS job_id
       FROM character_understanding_snapshots s
       JOIN character_understanding_runs ur ON ur.id=s.understanding_run_id
       JOIN entry_revisions er ON er.id=ur.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
         AND j.input_generation=er.revision_number
       WHERE s.id=? AND s.owner_user_id=? AND e.owner_user_id=?
         AND e.analysis_domain=? AND e.status='understanding_review' AND s.status IN ('proposed','needs_review')`)
    .bind(...bindings);
}

export function insertUnderstandingReviews7(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    snapshotId: unknown,
    snapshotIdAgain: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO understanding_reviews (id,owner_user_id,snapshot_id,target_type,target_id,decision,review_generation,created_at) VALUES (?,?,?,'snapshot',?,'confirm',1,?)`,
    )
    .bind(...bindings);
}

export function updateCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [snapshotId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE character_understanding_snapshots SET status='confirmed' WHERE id=? AND owner_user_id=? AND status IN ('proposed','needs_review')`,
    )
    .bind(...bindings);
}

export function updateCharacterAssertions3(
  db: D1Database,
  bindings: readonly [snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE character_assertions SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`)
    .bind(...bindings);
}

export function updateCustomizationDeltas3(
  db: D1Database,
  bindings: readonly [snapshotId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE customization_deltas SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [now: unknown, entry_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE user_character_entries SET status='analyzing',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: unknown, job_id: unknown, ownerUserId: unknown, entry_id: unknown, revision_number: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='queued',current_step='preferenceAnalysis',progress_current=8,
       workflow_instance_id=NULL,completed_at=NULL,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND target_type='entry' AND target_id=? AND input_generation=?
         AND status='waiting_for_user'`)
    .bind(...bindings);
}

export function insertUnderstandingReviews8(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    ownerUserId: unknown,
    base_snapshot_id: unknown,
    base_snapshot_idAgain: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO understanding_reviews (id,owner_user_id,snapshot_id,target_type,target_id,decision,review_generation,created_at) VALUES (?,?,?,'snapshot',?,'confirm',1,?)`,
    )
    .bind(...bindings);
}

export function updateCharacterUnderstandingSnapshots2(
  db: D1Database,
  bindings: readonly [base_snapshot_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE character_understanding_snapshots SET status='confirmed' WHERE id=? AND owner_user_id=? AND status IN ('proposed','needs_review')`,
    )
    .bind(...bindings);
}

export function updateCharacterAssertions4(
  db: D1Database,
  bindings: readonly [base_snapshot_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE character_assertions SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`)
    .bind(...bindings);
}
