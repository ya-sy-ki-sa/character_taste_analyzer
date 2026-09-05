import type { AnalysisDomain } from "../../../../shared/analysis-domain";

/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: string, ownerUserIdAgain: string],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT pa.id, e.id AS entry_id, pa.entry_revision_id, pa.character_identity_id, ci.work_id,
           e.analysis_domain,
           pa.attribute_definition_id, ad.stable_key, ad.label, ad.category, rm.raw_label,
           rm.normalized_label, pa.polarity, pa.response_channel, pa.strength, pa.explicitness,
           pa.confidence, pa.context_json,pa.status,
           COUNT(ef.id) AS evidence_count,
           COALESCE(GROUP_CONCAT(ef.id || ':' || ef.verification_status || ':' || ef.support_type), '') AS evidence_fingerprint,
           COALESCE(MAX(CASE ef.verification_status
             WHEN 'verified_quote' THEN CASE ef.evidence_origin WHEN 'user_input' THEN 1.0 WHEN 'review' THEN 1.0 ELSE 0.9 END
             WHEN 'source_attributed' THEN 0.7 WHEN 'model_knowledge' THEN 0.35
             ELSE 0.1 END), 0.1) AS evidence_quality
    FROM preference_assertions pa
    JOIN entry_revisions er ON er.id = pa.entry_revision_id
    JOIN user_character_entries e ON e.id = er.entry_id AND e.active_revision_number = er.revision_number
    JOIN character_identities ci ON ci.id = pa.character_identity_id
    LEFT JOIN attribute_definitions ad ON ad.id = pa.attribute_definition_id
    JOIN raw_attribute_mentions rm ON rm.id = pa.raw_mention_id
    LEFT JOIN evidence_fragments ef ON ef.owner_type = 'preference_assertion' AND ef.owner_id = pa.id AND ef.verification_status!='invalid'
    WHERE pa.owner_user_id = ? AND pa.status IN ('confirmed', 'corrected') AND NOT (EXISTS (SELECT 1 FROM evidence_fragments invalid WHERE invalid.owner_type='preference_assertion' AND invalid.owner_id=pa.id AND invalid.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments valid WHERE valid.owner_type='preference_assertion' AND valid.owner_id=pa.id AND valid.verification_status!='invalid'))
      AND e.owner_user_id = ? AND e.status = 'active'
      AND pa.analysis_run_id=(SELECT latest.id FROM analysis_runs latest WHERE latest.entry_revision_id=pa.entry_revision_id AND latest.owner_user_id=pa.owner_user_id AND latest.status='succeeded' ORDER BY latest.run_generation DESC LIMIT 1)
    GROUP BY pa.id
    ORDER BY pa.id
  `)
    .bind(...bindings);
}

export function selectGenerationFeedback(
  db: D1Database,
  bindings: readonly [ownerUserId: string],
): D1PreparedStatement {
  return db
    .prepare(`SELECT f.id,'feedback:' || COALESCE(json_extract(f.preference_json,'$.sourceCandidateId'),f.candidate_id,f.id) AS entry_id, f.id AS entry_revision_id,
    'feedback:' || COALESCE(json_extract(f.preference_json,'$.sourceCandidateId'),f.candidate_id,f.id) AS character_identity_id,NULL AS work_id,f.analysis_domain,
    d.id AS attribute_definition_id,d.stable_key,d.label,d.category,d.label AS raw_label,d.label AS normalized_label,
    json_extract(f.preference_json,'$.polarity') AS polarity,json_extract(f.preference_json,'$.responseChannel') AS response_channel,
    1.0 AS strength,'user_explicit' AS explicitness,1.0 AS confidence,
    json_object('schemaVersion','2','entryScope',json_extract(f.preference_json,'$.scope'),'subjects',json('[]'),'relationships',json('[]'),'narrativePhases',json('[]'),'conditions',json('[]'),'exceptions',json('[]')) AS context_json,
    f.status,1 AS evidence_count,1.0 AS evidence_quality,f.request_hash AS evidence_fingerprint
    FROM generation_feedback f JOIN attribute_definitions d ON d.id=json_extract(f.preference_json,'$.attributeId')
    WHERE f.owner_user_id=? AND f.status='confirmed' ORDER BY f.id`)
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: string, ownerUserIdAgain: string],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT vs.id,e.id AS entry_id,cr.character_identity_id,ci.work_id,
           vs.target_type, vs.target_ref, vs.stance, vs.orientation, vs.scope_json,e.analysis_domain,
           vs.explicitness, vs.confidence,vs.status,COUNT(ef.id) AS evidence_count,
           COALESCE(GROUP_CONCAT(ef.id || ':' || ef.verification_status || ':' || ef.support_type), '') AS evidence_fingerprint,
           COALESCE(MAX(CASE ef.verification_status
             WHEN 'verified_quote' THEN CASE ef.evidence_origin WHEN 'user_input' THEN 1.0 WHEN 'review' THEN 1.0 ELSE 0.9 END
             WHEN 'source_attributed' THEN 0.7 WHEN 'model_knowledge' THEN 0.35
             ELSE 0.1 END), 0.1) AS evidence_quality
    FROM value_stance_assertions vs
    JOIN analysis_runs ar ON ar.id = vs.analysis_run_id
    JOIN entry_revisions er ON er.id = ar.entry_revision_id
    JOIN user_character_entries e ON e.id = er.entry_id AND e.active_revision_number = er.revision_number
    JOIN character_representations cr ON cr.id=er.representation_id
    JOIN character_identities ci ON ci.id=cr.character_identity_id
    LEFT JOIN evidence_fragments ef ON ef.owner_type = 'value_stance_assertion' AND ef.owner_id = vs.id AND ef.verification_status!='invalid'
    WHERE vs.owner_user_id = ? AND vs.status IN ('confirmed', 'corrected') AND NOT (EXISTS (SELECT 1 FROM evidence_fragments invalid WHERE invalid.owner_type='value_stance_assertion' AND invalid.owner_id=vs.id AND invalid.verification_status='invalid') AND NOT EXISTS (SELECT 1 FROM evidence_fragments valid WHERE valid.owner_type='value_stance_assertion' AND valid.owner_id=vs.id AND valid.verification_status!='invalid'))
      AND e.owner_user_id = ? AND e.status = 'active'
      AND ar.id=(SELECT latest.id FROM analysis_runs latest WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded' ORDER BY latest.run_generation DESC LIMIT 1)
    GROUP BY vs.id ORDER BY vs.id
  `)
    .bind(...bindings);
}

export function selectProfileProjections(
  db: D1Database,
  bindings: readonly [ownerUserId: string],
): D1PreparedStatement {
  return db
    .prepare(`SELECT generation FROM profile_projections WHERE owner_user_id = ? ORDER BY generation DESC LIMIT 1`)
    .bind(...bindings);
}

export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: string],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function insertProfileProjections(
  db: D1Database,
  bindings: readonly [
    projectionId: string,
    ownerUserId: string,
    generation: number,
    ontologyVersion: string,
    algorithmVersion: string,
    evidenceSetHash: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO profile_projections (id, owner_user_id, generation, ontology_version, algorithm_version, evidence_set_hash, status, revision, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 'building', 1, ?, NULL)`,
    )
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [
    ownerUserId: string,
    generation: number,
    builtGeneration: number,
    projectionId: string,
    leaseExpiresAt: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO projection_rebuild_states
        (owner_user_id,desired_generation,built_generation,status,lease_owner,lease_expires_at,updated_at)
      VALUES (?,?,?,'building',?,?,?)
      ON CONFLICT(owner_user_id) DO UPDATE SET status='building',lease_owner=excluded.lease_owner,
        lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at
      WHERE projection_rebuild_states.desired_generation=excluded.desired_generation
    `)
    .bind(...bindings);
}

export function insertProfileDimensions(
  db: D1Database,
  bindings: readonly [
    id: string,
    projectionId: string,
    attributeDefinitionId: string | null,
    rawLabel: string,
    responseChannel: string | null,
    conditionHash: string,
    conditionJson: string,
    positiveScore: number,
    negativeScore: number,
    confidence: number,
    evidenceCount: number,
    identityCount: number,
    workCount: number,
    classification: string,
    flagsJson: string,
    ordinal: number,
    now: string,
    analysisDomain: AnalysisDomain,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO profile_dimensions
        (id, profile_projection_id, attribute_definition_id, raw_label, response_channel, condition_hash,
         condition_json, positive_score, negative_score, confidence, evidence_count, identity_count,
         work_count, classification, flags_json, rank_order, created_at,analysis_domain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
    `)
    .bind(...bindings);
}

export function insertProfileSnapshots(
  db: D1Database,
  bindings: readonly [
    profileSnapshotId: string,
    ownerUserId: string,
    projectionId: string,
    generation: number,
    evidenceSetHash: string,
    ontologyVersion: string,
    algorithmVersion: string,
    contentHash: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
    INSERT INTO profile_snapshots
      (id, owner_user_id, profile_projection_id, profile_generation, evidence_set_hash, ontology_version,
       algorithm_version, correction_version, content_hash, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'profile_rebuild', ?)
  `)
    .bind(...bindings);
}

export function insertProfileSnapshotItems(
  db: D1Database,
  bindings: readonly [
    id: string,
    profileSnapshotId: string,
    sourceDimensionId: string | null,
    type: string,
    stableKey: string,
    label: string,
    payloadJson: string,
    payloadHash: string,
    ordinal: number,
    now: string,
    analysisDomain: AnalysisDomain,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO profile_snapshot_items
        (id, profile_snapshot_id, source_dimension_id, item_type, stable_key,
         label, payload_json, content_hash, ordinal, created_at,analysis_domain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
    `)
    .bind(...bindings);
}

export function selectDesiredGeneration(db: D1Database, bindings: readonly [ownerUserId: string]): D1PreparedStatement {
  return db.prepare(`SELECT desired_generation FROM projection_rebuild_states WHERE owner_user_id=?`).bind(...bindings);
}

export function updateProfileProjections(
  db: D1Database,
  bindings: readonly [projectionId: string],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE profile_projections SET status='superseded' WHERE id=? AND status='building'`)
    .bind(...bindings);
}

export function updateGraphProjectionSnapshots(
  db: D1Database,
  bindings: readonly [graphProjectionId: string],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE graph_projection_snapshots SET status='superseded' WHERE id=? AND status='building'`)
    .bind(...bindings);
}

export function supersedeCurrentProfile(
  db: D1Database,
  bindings: readonly [ownerUserId: string, ownerUserIdAgain: string, generation: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE profile_projections SET status='superseded'
       WHERE owner_user_id=? AND status='current'
         AND EXISTS (SELECT 1 FROM projection_rebuild_states WHERE owner_user_id=? AND desired_generation=?)`)
    .bind(...bindings);
}

export function supersedeCurrentGraph(
  db: D1Database,
  bindings: readonly [ownerUserId: string, ownerUserIdAgain: string, generation: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE graph_projection_snapshots SET status='superseded'
       WHERE owner_user_id=? AND status='current'
         AND EXISTS (SELECT 1 FROM projection_rebuild_states WHERE owner_user_id=? AND desired_generation=?)`)
    .bind(...bindings);
}

export function activateBuiltProfile(
  db: D1Database,
  bindings: readonly [completed: string, projectionId: string, ownerUserId: string, generation: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE profile_projections SET status='current',completed_at=?,revision=revision+1
       WHERE id=? AND status='building'
         AND EXISTS (SELECT 1 FROM projection_rebuild_states WHERE owner_user_id=? AND desired_generation=?)`)
    .bind(...bindings);
}

export function activateBuiltGraph(
  db: D1Database,
  bindings: readonly [completed: string, graphProjectionId: string, ownerUserId: string, generation: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE graph_projection_snapshots SET status='current',completed_at=?
       WHERE id=? AND status='building'
         AND EXISTS (SELECT 1 FROM projection_rebuild_states WHERE owner_user_id=? AND desired_generation=?)`)
    .bind(...bindings);
}

export function updateProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [generation: number, completed: string, ownerUserId: string, generationAgain: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE projection_rebuild_states SET built_generation=?,status='current',lease_owner=NULL,
      lease_expires_at=NULL,last_error_code=NULL,updated_at=?
      WHERE owner_user_id=? AND desired_generation=?`)
    .bind(...bindings);
}

export function selectCurrentProfile(db: D1Database, bindings: readonly [ownerUserId: string]): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id, generation, evidence_set_hash, algorithm_version, completed_at FROM profile_projections WHERE owner_user_id=? AND status='current'`,
    )
    .bind(...bindings);
}

export function selectProfileSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: string, id: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id FROM profile_snapshots WHERE owner_user_id=? AND profile_projection_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectProfileDimensions(
  db: D1Database,
  bindings: readonly [id: string, analysisDomain: AnalysisDomain],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT pd.id, ad.stable_key, pd.raw_label, ad.label, ad.category, pd.response_channel, pd.condition_json,
           pd.positive_score, pd.negative_score, pd.confidence, pd.evidence_count, pd.identity_count,pd.work_count,
           pd.classification, pd.flags_json
    FROM profile_dimensions pd LEFT JOIN attribute_definitions ad ON ad.id=pd.attribute_definition_id
    WHERE pd.profile_projection_id=? AND pd.analysis_domain=? ORDER BY pd.rank_order, pd.id
  `)
    .bind(...bindings);
}

export function selectActiveAttributeLabels(
  db: D1Database,
  bindings: readonly [analysisDomain: AnalysisDomain],
): D1PreparedStatement {
  return db
    .prepare(`SELECT ad.stable_key,ad.label FROM attribute_definitions ad JOIN attribute_schema_versions v ON v.id=ad.schema_version_id
    WHERE ad.status='active' AND v.status='active' AND v.analysis_domain=?`)
    .bind(...bindings);
}

export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [ownerUserId: string, analysisDomain: AnalysisDomain],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COUNT(*) AS count FROM user_character_entries WHERE owner_user_id=? AND analysis_domain=? AND status='active'`,
    )
    .bind(...bindings);
}

export function selectProjectionFreshness(
  db: D1Database,
  bindings: readonly [ownerUserId: string],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT desired_generation,built_generation,status,last_error_code FROM projection_rebuild_states WHERE owner_user_id=?`,
    )
    .bind(...bindings);
}

export function selectCurrentProfileVersion(
  db: D1Database,
  bindings: readonly [ownerUserId: string],
): D1PreparedStatement {
  return db
    .prepare(`SELECT generation,algorithm_version FROM profile_projections WHERE owner_user_id=? AND status='current'`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    resultJson: string,
    now: string,
    nowAgain: string,
    jobId: string,
    ownerUserId: string,
    desiredGeneration: number,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='succeeded',current_step='complete',progress_current=2,result_ref_json=?,
         updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running' AND input_generation=?`)
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

export function recordProfileJobFailure(
  db: D1Database,
  bindings: readonly [status: string, retryable: number, code: string, now: string, nowAgain: string, jobId: string],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status=?,retryable=?,error_code=?,updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND status!='succeeded'`)
    .bind(...bindings);
}

export function recordProjectionFailure(
  db: D1Database,
  bindings: readonly [code: string, now: string, ownerUserId: string, desiredGeneration: number],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE projection_rebuild_states SET status='failed',last_error_code=?,lease_owner=NULL,
               lease_expires_at=NULL,updated_at=? WHERE owner_user_id=? AND desired_generation=?`)
    .bind(...bindings);
}
