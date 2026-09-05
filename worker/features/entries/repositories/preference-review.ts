/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [analysisRunId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT ar.id
       FROM analysis_runs ar
       JOIN entry_revisions er ON er.id=ar.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=?
         AND ar.status='succeeded' AND e.status='analysis_review'
         AND ar.run_generation=(SELECT MAX(latest.run_generation) FROM analysis_runs latest WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded')`)
    .bind(...bindings);
}

export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [
    targetId: unknown,
    ownerUserId: unknown,
    analysisRunId: unknown,
    targetIdAgain: unknown,
    ownerUserIdAgain: unknown,
    analysisRunIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`SELECT 'preference_assertion' AS target_type,status
       FROM preference_assertions WHERE id=? AND owner_user_id=? AND analysis_run_id=?
       UNION ALL
       SELECT 'value_stance_assertion' AS target_type,status
       FROM value_stance_assertions WHERE id=? AND owner_user_id=? AND analysis_run_id=?`)
    .bind(...bindings);
}

export function updatePreferenceAssertions(db: D1Database): D1PreparedStatement {
  return db.prepare(`UPDATE preference_assertions SET status='rejected'
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`);
}

export function updateValueStanceAssertions(db: D1Database): D1PreparedStatement {
  return db.prepare(`UPDATE value_stance_assertions SET status='rejected'
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`);
}

export function selectPreferenceAssertions2(
  db: D1Database,
  bindings: readonly [changedId: unknown, ownerUserId: unknown, changedIdAgain: unknown, ownerUserIdAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM preference_assertions WHERE id=? AND owner_user_id=?
       UNION ALL SELECT id FROM value_stance_assertions WHERE id=? AND owner_user_id=? LIMIT 1`)
    .bind(...bindings);
}

export function selectAnalysisRuns2(
  db: D1Database,
  bindings: readonly [analysisRunId: unknown, ownerUserId: unknown, ownerUserIdAgain: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT ar.entry_revision_id,cr.character_identity_id,er.representation_id,er.registration_payload_json
       FROM analysis_runs ar
       JOIN entry_revisions er ON er.id=ar.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN character_representations cr ON cr.id=er.representation_id
       WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=?
         AND ar.status='succeeded' AND e.status='analysis_review'
         AND ar.run_generation=(SELECT MAX(latest.run_generation) FROM analysis_runs latest WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded')`)
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [attributeStableKey: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT d.id FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id
             WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=? LIMIT 1`)
    .bind(...bindings);
}

export function selectPreferenceAssertions3(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT raw_mention_id,context_json FROM preference_assertions
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`)
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

export function insertRawAttributeMentions(
  db: D1Database,
  bindings: readonly [
    rawId: unknown,
    ownerUserId: unknown,
    changedId: unknown,
    rawLabel: unknown,
    value4: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,locale,normalized_label,created_at)
         VALUES (?,?,'user','preference_assertion',?,?,'ja',?,?)`)
    .bind(...bindings);
}

export function insertAttributeMappings(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    rawId: unknown,
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

export function insertPreferenceAssertions(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    ownerUserId: unknown,
    analysisRunId: unknown,
    entry_revision_id: unknown,
    character_identity_id: unknown,
    representation_id: unknown,
    value6: unknown,
    rawId: unknown,
    analysisDomain: unknown,
    polarity: unknown,
    responseChannel: unknown,
    strength: unknown,
    value12: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO preference_assertions
          (id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
           attribute_definition_id,raw_mention_id,analysis_domain,polarity,response_channel,strength,explicitness,
           confidence,context_json,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'user_confirmed',1,?,'corrected',?)`)
    .bind(...bindings);
}

export function updatePreferenceAssertions2(
  db: D1Database,
  bindings: readonly [changedId: unknown, targetId: unknown, ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE preference_assertions SET status='superseded',superseded_by_id=?
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT scope_json FROM value_stance_assertions
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

export function insertValueStanceAssertions(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    ownerUserId: unknown,
    analysisRunId: unknown,
    targetRef: unknown,
    stance: unknown,
    orientation: unknown,
    value6: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO value_stance_assertions
          (id,owner_user_id,analysis_run_id,target_type,target_ref,stance,orientation,scope_json,
           explicitness,confidence,status,created_at)
         VALUES (?,?,?,'value',?,?,?,?, 'user_confirmed',1,'corrected',?)`)
    .bind(...bindings);
}

export function updateValueStanceAssertions2(
  db: D1Database,
  bindings: readonly [changedId: unknown, targetId: unknown, ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE value_stance_assertions SET status='superseded',superseded_by_id=?
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}
