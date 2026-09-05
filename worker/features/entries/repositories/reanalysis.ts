import type { AnalysisDomain } from "../../../../shared/analysis-domain";

/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [entryId: string, ownerUserId: string, analysisDomain: AnalysisDomain],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT e.status,e.active_revision_number,
        er.representation_id,er.source_set_id,er.preference_context,er.user_character_view,er.registration_payload_json,
        cr.character_identity_id,ci.work_id
      FROM user_character_entries e
      JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
      JOIN character_representations cr ON cr.id=er.representation_id
      JOIN character_identities ci ON ci.id=cr.character_identity_id
      WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=?
    `)
    .bind(...bindings);
}

export function selectJobs(
  db: D1Database,
  bindings: readonly [ownerUserId: string, revisionId: string, entryId: string],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT er.revision_number,er.content_hash,
        (SELECT id FROM jobs WHERE owner_user_id=? AND target_type='entry' AND target_id=er.entry_id
          AND input_generation=er.revision_number LIMIT 1) AS job_id
      FROM entry_revisions er WHERE er.id=? AND er.entry_id=?
    `)
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

export function insertEntryRevisions(
  db: D1Database,
  bindings: readonly [
    revisionId: string,
    entryId: string,
    revisionNumber: number,
    representationId: string,
    sourceSetId: string | null,
    preferenceContext: string | null,
    userCharacterView: string | null,
    preferenceJson: string,
    payloadJson: string,
    contentHash: string,
    now: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO entry_revisions
        (id,entry_id,revision_number,representation_id,source_set_id,preference_context,user_character_view,
         preference_input_json,registration_payload_json,content_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function insertJobs(
  db: D1Database,
  bindings: readonly [
    jobId: string,
    ownerUserId: string,
    entryId: string,
    revisionNumber: number,
    quotaReservationId: string,
    now: string,
    nowAgain: string,
    analysisDomain: AnalysisDomain,
    llmRoutingSnapshotJson: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs
        (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,
         current_step,retryable,revision,quota_reservation_id,created_at,updated_at,analysis_domain,llm_routing_snapshot_json)
       VALUES (?,?,'character_analysis','queued','entry',?,?,0,15,'queued',1,1,?,?,?,?,?)`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [now: string, nowAgain: string, ownerUserId: string, entryId: string, jobId: string],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='superseded',updated_at=?,completed_at=?,revision=revision+1
      WHERE owner_user_id=? AND target_type='entry' AND target_id=? AND id<>?
         AND status IN ('queued','waiting_for_user','retrying')`)
    .bind(...bindings);
}

export function updateUserCharacterEntries(
  db: D1Database,
  bindings: readonly [
    revisionNumber: number,
    now: string,
    entryId: string,
    ownerUserId: string,
    active_revision_number: number,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='submitted',active_revision_number=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND active_revision_number=?`)
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: string, desiredGeneration: number, builtGeneration: number, now: string],
): D1PreparedStatement {
  return db
    .prepare(`
            INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
            VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
              desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
          `)
    .bind(...bindings);
}

export function insertProfileRebuildJob(
  db: D1Database,
  bindings: readonly [
    profileJobId: string,
    ownerUserId: string,
    ownerUserIdAgain: string,
    desiredGeneration: number,
    now: string,
    nowAgain: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
             progress_total,current_step,retryable,revision,created_at,updated_at)
             VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?)`)
    .bind(...bindings);
}
