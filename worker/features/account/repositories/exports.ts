/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectAccountExports(
  db: D1Database,
  bindings: readonly [exportId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db.prepare(`SELECT id,job_id,status FROM account_exports WHERE id=? AND owner_user_id=?`).bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: unknown,
    ownerUserId: unknown,
    exportId: unknown,
    id: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs
        (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,
         current_step,retryable,revision,quota_reservation_id,created_at,updated_at)
       VALUES (?,?,'export','queued','account_export',?,1,0,2,'collect',1,1,?,?,?)`)
    .bind(...bindings);
}

export function insertAccountExports(
  db: D1Database,
  bindings: readonly [exportId: unknown, ownerUserId: unknown, jobId: unknown, now: unknown, nowAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO account_exports (id,owner_user_id,job_id,status,schema_version,created_at,updated_at)
       VALUES (?,?,?,'queued','4.0',?,?)`)
    .bind(...bindings);
}

export function updateAccountExports(
  db: D1Database,
  bindings: readonly [started: unknown, exportId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE account_exports SET status='running',updated_at=? WHERE id=? AND owner_user_id=? AND status IN ('queued','failed')`,
    )
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [
    value0Json: unknown,
    completed: unknown,
    completedAgain: unknown,
    jobId: unknown,
    ownerUserId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='succeeded',current_step='complete',progress_current=2,result_ref_json=?,
         updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running'`)
    .bind(...bindings);
}

export function updateAccountExports2(
  db: D1Database,
  bindings: readonly [
    objectKey: unknown,
    value1: unknown,
    byteLength: unknown,
    completed: unknown,
    completedAgain: unknown,
    expiresAt: unknown,
    exportId: unknown,
    ownerUserId: unknown,
    jobId: unknown,
    ownerUserIdAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE account_exports SET status='ready',object_key=?,content_hash=?,byte_size=?,updated_at=?,completed_at=?,expires_at=?
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

export function updateAccountExports3(
  db: D1Database,
  bindings: readonly [code: unknown, now: unknown, exportId: unknown, ownerUserId: unknown, jobId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE account_exports SET status='failed',error_code=?,updated_at=?
         WHERE id=? AND owner_user_id=? AND status!='ready'
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status!='succeeded')`)
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    code: unknown,
    value2: unknown,
    value3: unknown,
    now: unknown,
    value5: unknown,
    jobId: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status=?,error_code=?,retryable=?,next_attempt_at=?,updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND status!='succeeded'`)
    .bind(...bindings);
}

export function selectAccountExports2(db: D1Database, bindings: readonly [value0: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT id,object_key FROM account_exports WHERE status='ready' AND expires_at<=? LIMIT 100`)
    .bind(...bindings);
}

export function updateAccountExports4(
  db: D1Database,
  bindings: readonly [value0: unknown, value1: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE account_exports SET status='expired',object_key=NULL,updated_at=? WHERE status='ready' AND expires_at<=?`,
    )
    .bind(...bindings);
}

export function deleteAccountExports(
  db: D1Database,
  bindings: readonly [metadataCutoff: unknown],
): D1PreparedStatement {
  return db.prepare(`DELETE FROM account_exports WHERE status='expired' AND created_at<?`).bind(...bindings);
}

export function selectExportUser(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,username,status,membership_tier,is_public,activated_at,created_at,updated_at FROM users WHERE id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportEntries(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM user_character_entries WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportRevisions(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT er.* FROM entry_revisions er JOIN user_character_entries e ON e.id=er.entry_id WHERE e.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportWorks(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM works WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportIdentities(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM character_identities WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportRepresentations(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM character_representations WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportSources(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM sources WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportSourceSets(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM source_sets WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportSourceSetItems(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(`SELECT i.* FROM source_set_items i JOIN source_sets s ON s.id=i.source_set_id WHERE s.owner_user_id=?`)
    .bind(ownerUserId);
}

export function selectExportUnderstandingRuns(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM character_understanding_runs WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportUnderstandingSnapshots(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM character_understanding_snapshots WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportCharacterAssertions(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM character_assertions WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportCustomizationDeltas(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM customization_deltas WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportUnderstandingReviews(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM understanding_reviews WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportAnalysisRuns(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM analysis_runs WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportPreferenceAssertions(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM preference_assertions WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportValueStances(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM value_stance_assertions WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportEvidence(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM evidence_fragments WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportProfiles(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM profile_projections WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportProfileDimensions(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT d.* FROM profile_dimensions d JOIN profile_projections p ON p.id=d.profile_projection_id WHERE p.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportProfileSnapshots(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM profile_snapshots WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportProfileSnapshotItems(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT i.* FROM profile_snapshot_items i JOIN profile_snapshots s ON s.id=i.profile_snapshot_id WHERE s.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGraphSnapshots(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM graph_projection_snapshots WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportGraphNodes(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT n.* FROM graph_projection_nodes n JOIN graph_projection_snapshots s ON s.id=n.projection_snapshot_id WHERE s.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGraphEdges(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT e.* FROM graph_projection_edges e JOIN graph_projection_snapshots s ON s.id=e.projection_snapshot_id WHERE s.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGenerationRequests(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM generation_requests WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportGenerationPreferences(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT p.* FROM generation_request_preferences p JOIN generation_requests r ON r.id=p.generation_request_id WHERE r.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGenerationBriefs(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT b.* FROM generation_briefs b JOIN generation_requests r ON r.id=b.generation_request_id WHERE r.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGeneratedCharacters(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM generated_characters WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportGenerationBasisLinks(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT l.* FROM generation_basis_links l JOIN generated_characters c ON c.id=l.generated_character_id WHERE c.owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportGenerationValidations(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM generation_validation_runs WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportModelRuns(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM model_run_metadata WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportJobs(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,workflow_instance_id,revision,created_at,updated_at,completed_at FROM jobs WHERE owner_user_id=?`,
    )
    .bind(ownerUserId);
}

export function selectExportJobAttempts(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(`SELECT a.* FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.owner_user_id=?`)
    .bind(ownerUserId);
}

export function selectExportDarkScopeAssessments(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM dark_scope_assessments WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportDarkBaselineSnapshots(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM dark_baseline_snapshots WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportDarkTransformationDeltas(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM dark_transformation_deltas WHERE owner_user_id=?`).bind(ownerUserId);
}

export function selectExportQualityCandidates(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(`SELECT * FROM generation_candidates WHERE owner_user_id=? ORDER BY created_at,id`)
    .bind(ownerUserId);
}

export function selectExportGenerationFeedback(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db.prepare(`SELECT * FROM generation_feedback WHERE owner_user_id=? ORDER BY created_at,id`).bind(ownerUserId);
}

export function selectExportPreferenceRefinements(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(`SELECT * FROM preference_refinements WHERE owner_user_id=? ORDER BY created_at,id`)
    .bind(ownerUserId);
}

export function selectExportSimilarityDocuments(db: D1Database, ownerUserId: string): D1PreparedStatement {
  return db
    .prepare(`SELECT * FROM character_similarity_documents WHERE owner_user_id=? ORDER BY created_at,id`)
    .bind(ownerUserId);
}
