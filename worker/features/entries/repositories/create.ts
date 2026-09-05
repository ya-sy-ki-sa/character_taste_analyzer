import type { AnalysisDomain } from "../../../../shared/analysis-domain";

/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [ownerUserId: string, analysisDomain: AnalysisDomain, seed: string],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT e.id,j.id AS job_id,e.status,er.content_hash FROM user_character_entries e
      JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
      JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
      WHERE e.owner_user_id=? AND e.analysis_domain=? AND e.creation_idempotency_hash=?
      ORDER BY e.created_at DESC LIMIT 1
    `)
    .bind(...bindings);
}

export function insertUserCharacterEntries(
  db: D1Database,
  bindings: readonly [
    entryId: string,
    ownerUserId: string,
    registrationType: string,
    seed: string,
    now: string,
    nowAgain: string,
    analysisDomain: AnalysisDomain,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_character_entries (id,owner_user_id,registration_type,status,active_revision_number,active_generation,creation_idempotency_hash,revision,created_at,updated_at,analysis_domain) VALUES (?,?,?,'submitted',1,0,?,1,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertEntryRevisions(
  db: D1Database,
  bindings: readonly [
    revisionId: string,
    entryId: string,
    representationId: string,
    sourceSetId: string | null,
    preferenceContext: string | null,
    userCharacterView: string | null,
    preferenceJson: string,
    payloadJson: string,
    payloadHash: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO entry_revisions (id,entry_id,revision_number,representation_id,source_set_id,preference_context,user_character_view,preference_input_json,registration_payload_json,content_hash,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: string,
    ownerUserId: string,
    entryId: string,
    quotaReservationId: string,
    now: string,
    nowAgain: string,
    analysisDomain: AnalysisDomain,
    llmRoutingSnapshotJson: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,quota_reservation_id,created_at,updated_at,analysis_domain,llm_routing_snapshot_json) VALUES (?,?,'character_analysis','queued','entry',?,1,0,15,'queued',1,1,?,?,?,?,?)`,
    )
    .bind(...bindings);
}
