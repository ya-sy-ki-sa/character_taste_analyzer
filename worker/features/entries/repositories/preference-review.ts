/** D1 statements for this use case. Callers compose atomic batches across repositories. */
function reviewableAssertion(table: "preference_assertions" | "value_stance_assertions"): string {
  return `EXISTS (SELECT 1 FROM analysis_runs ar
    JOIN entry_revisions er ON er.id=ar.entry_revision_id
    JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
    WHERE ar.id=${table}.analysis_run_id AND ar.owner_user_id=${table}.owner_user_id
      AND e.owner_user_id=ar.owner_user_id AND e.status='analysis_review' AND ar.status='succeeded'
      AND ar.run_generation=(SELECT MAX(latest.run_generation) FROM analysis_runs latest
        WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded'))`;
}

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
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected') AND ${reviewableAssertion("preference_assertions")}`);
}

export function updateValueStanceAssertions(db: D1Database): D1PreparedStatement {
  return db.prepare(`UPDATE value_stance_assertions SET status='rejected'
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected') AND ${reviewableAssertion("value_stance_assertions")}`);
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
    .prepare(`SELECT d.id,d.label FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id
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

export function updatePreferenceAssertions2(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    targetId: unknown,
    ownerUserId: unknown,
    analysisRunId: unknown,
    changedIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE preference_assertions SET status='superseded',superseded_by_id=?
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')
               AND EXISTS (SELECT 1 FROM preference_assertions replacement WHERE replacement.id=?)`)
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown, analysisRunId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT scope_json,target_type FROM value_stance_assertions
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`)
    .bind(...bindings);
}

/** The active-row predicate is evaluated inside the batch, including concurrent retries. */
export function copyPreferenceWithChannel(
  db: D1Database,
  bindings: readonly [
    changedId: unknown,
    responseChannel: unknown,
    now: unknown,
    targetId: unknown,
    ownerUserId: unknown,
    analysisRunId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO preference_assertions
    (id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
     attribute_definition_id,raw_mention_id,analysis_domain,polarity,response_channel,strength,
     explicitness,confidence,context_json,status,created_at)
    SELECT ?,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
     attribute_definition_id,raw_mention_id,analysis_domain,polarity,?,strength,
     explicitness,confidence,context_json,'corrected',?
    FROM preference_assertions WHERE id=? AND owner_user_id=? AND analysis_run_id=?
      AND status IN ('proposed','corrected') AND ${reviewableAssertion("preference_assertions")}`)
    .bind(...bindings);
}

export function selectPreferenceEvidenceIds(
  db: D1Database,
  bindings: readonly [targetId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM evidence_fragments
    WHERE owner_type='preference_assertion' AND owner_id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function copyPreferenceEvidence(
  db: D1Database,
  bindings: readonly [
    newEvidenceId: unknown,
    changedId: unknown,
    evidenceId: unknown,
    ownerUserId: unknown,
    changedIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO evidence_fragments
    (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,quote_start,quote_end,
     quote_hash,excerpt_text,user_input_path,verification_status,inference_type,confidence,created_at)
    SELECT ?,e.owner_user_id,e.owner_type,?,e.source_id,e.evidence_origin,e.support_type,e.quote_start,e.quote_end,
     e.quote_hash,e.excerpt_text,e.user_input_path,e.verification_status,e.inference_type,e.confidence,e.created_at
    FROM evidence_fragments e JOIN preference_assertions old ON old.id=e.owner_id
    WHERE e.id=? AND e.owner_user_id=? AND e.owner_type='preference_assertion'
      AND old.status IN ('proposed','corrected')
      AND EXISTS (SELECT 1 FROM preference_assertions WHERE id=?)`)
    .bind(...bindings);
}
