/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [entryId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT e.status,e.registration_type,er.registration_payload_json,er.id AS revision_id,er.representation_id
    FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=?
  `)
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, representation_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,base_snapshot_id,source_assessment_json,summary_json,uncertainties_json,overall_confidence,status FROM character_understanding_snapshots WHERE owner_user_id=? AND representation_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectCharacterAssertions(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT ca.id,COALESCE(ad.label,ca.raw_label) AS raw_label,ca.value_text,ca.assertion_kind,
                  ca.explicitness,ca.confidence,ca.status,ad.stable_key
           FROM character_assertions ca LEFT JOIN attribute_definitions ad ON ad.id=ca.attribute_definition_id
           WHERE ca.snapshot_id=? AND ca.status NOT IN ('rejected','superseded') ORDER BY ca.ordinal,ca.id`)
    .bind(...bindings);
}

export function selectCustomizationDeltas(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT id,operation,before_value,after_value,scope_json,reason_text,explicitness,confidence,status
           FROM customization_deltas WHERE snapshot_id=? AND status <> 'rejected' ORDER BY ordinal,id`)
    .bind(...bindings);
}

export function selectCharacterUnderstandingSnapshots2(
  db: D1Database,
  bindings: readonly [base_snapshot_id: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,source_assessment_json,summary_json,uncertainties_json,overall_confidence,status FROM character_understanding_snapshots WHERE id=? AND owner_user_id=?`,
    )
    .bind(...bindings);
}

export function selectCharacterAssertions2(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT ca.id,COALESCE(ad.label,ca.raw_label) AS raw_label,ca.value_text,ca.assertion_kind,
                  ca.explicitness,ca.confidence,ca.status,ad.stable_key
           FROM character_assertions ca LEFT JOIN attribute_definitions ad ON ad.id=ca.attribute_definition_id
           WHERE ca.snapshot_id=? AND ca.status NOT IN ('rejected','superseded') ORDER BY ca.ordinal,ca.id`)
    .bind(...bindings);
}

export function selectAnalysisRuns(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, revision_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,summary_json,uncertainties_json,status,quality_context_json FROM analysis_runs WHERE owner_user_id=? AND entry_revision_id=? ORDER BY run_generation DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectPreferenceRefinements(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, revision_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,mode,context_json,hypotheses_json FROM preference_refinements WHERE owner_user_id=? AND entry_revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function selectPreferenceAssertions(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT pa.id,COALESCE(ad.label,rm.raw_label) AS raw_label,pa.polarity,pa.response_channel,
                  pa.strength,pa.explicitness,pa.confidence,pa.status,ad.stable_key
           FROM preference_assertions pa JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id
           LEFT JOIN attribute_definitions ad ON ad.id=pa.attribute_definition_id
           WHERE pa.analysis_run_id=? AND pa.status NOT IN ('rejected','superseded')
           ORDER BY pa.created_at,pa.id`)
    .bind(...bindings);
}

export function selectValueStanceAssertions(db: D1Database, bindings: readonly [id: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT id,target_ref,stance,orientation,explicitness,confidence,status
           FROM value_stance_assertions
           WHERE analysis_run_id=? AND status NOT IN ('rejected','superseded')
           ORDER BY created_at,id`)
    .bind(...bindings);
}

export function selectDarkScopeAssessments(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, revision_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,verdict,status,assessment_json FROM dark_scope_assessments
             WHERE owner_user_id=? AND entry_revision_id=? LIMIT 1`)
    .bind(...bindings);
}

export function selectDarkBaselineSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, revision_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,baseline_json FROM dark_baseline_snapshots
             WHERE owner_user_id=? AND entry_revision_id=? LIMIT 1`)
    .bind(...bindings);
}

export function selectDarkTransformationDeltas(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,operation,aspect,before_value,after_value,detail_json,confidence
             FROM dark_transformation_deltas
             WHERE owner_user_id=? AND understanding_snapshot_id=? ORDER BY ordinal,id`)
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
            SELECT d.stable_key,d.label
            FROM attribute_definitions d
            JOIN attribute_schema_versions v ON v.id=d.schema_version_id
            WHERE v.status='active' AND v.analysis_domain=? AND d.status='active'
            ORDER BY d.stable_key
          `)
    .bind(...bindings);
}
