/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [entryId: unknown, ownerUserId: unknown, analysisDomain: unknown],
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
  bindings: readonly [ownerUserId: unknown, revisionId: unknown, entryId: unknown],
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

export function selectCharacterIdentities(
  db: D1Database,
  bindings: readonly [
    characterIdentityId: unknown,
    ownerUserId: unknown,
    analysisDomain: unknown,
    value3: unknown,
    workId: unknown,
    workIdAgain: unknown,
    value6: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
          SELECT ci.id AS identity_id,ci.work_id FROM character_identities ci LEFT JOIN works w ON w.id=ci.work_id
          WHERE ci.id=? AND ci.owner_user_id=? AND ci.analysis_domain=? AND ci.name_normalized=?
            AND (ci.work_id IS ? OR ci.work_id=?) AND (w.id IS NULL OR w.title_normalized=?)
        `)
    .bind(...bindings);
}

export function insertWorks(
  db: D1Database,
  bindings: readonly [
    workId: unknown,
    ownerUserId: unknown,
    workTitle: unknown,
    value3: unknown,
    value4: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO works (id,owner_user_id,title,title_normalized,media_type,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertCharacterIdentities(
  db: D1Database,
  bindings: readonly [
    identityId: unknown,
    value1: unknown,
    ownerUserId: unknown,
    workId: unknown,
    nextBaseCharacterName: unknown,
    value5: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_identities (id,origin_type,owner_user_id,work_id,name,name_normalized,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertCharacterRepresentations(
  db: D1Database,
  bindings: readonly [
    baseRepresentationId: unknown,
    identityId: unknown,
    ownerUserId: unknown,
    value3: unknown,
    value4: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,NULL,?,'canonical_whole','official','whole',?,NULL,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertCharacterRepresentations2(
  db: D1Database,
  bindings: readonly [
    representationId: unknown,
    identityId: unknown,
    baseRepresentationId: unknown,
    ownerUserId: unknown,
    representationType: unknown,
    canonicality: unknown,
    scopeType: unknown,
    value7: unknown,
    value8: unknown,
    value9: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertSourceSets(
  db: D1Database,
  bindings: readonly [
    sourceSetId: unknown,
    ownerUserId: unknown,
    sourceSetHash: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_sets (id,owner_user_id,purpose,content_hash,created_at,updated_at) VALUES (?,?,'character_understanding',?,?,?)`,
    )
    .bind(...bindings);
}

export function insertSources(
  db: D1Database,
  bindings: readonly [
    documentId: unknown,
    ownerUserId: unknown,
    value2: unknown,
    value3Json: unknown,
    byteLength: unknown,
    hash: unknown,
    value6Json: unknown,
    text: unknown,
    value8: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,?,'user_text',?,'user_supplied','text/plain',?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertSourceSetItems(
  db: D1Database,
  bindings: readonly [sourceSetId: unknown, documentId: unknown, value2: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,?,'user_definition')`,
    )
    .bind(...bindings);
}

export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function insertEntryRevisions(
  db: D1Database,
  bindings: readonly [
    revisionId: unknown,
    entryId: unknown,
    revisionNumber: unknown,
    representationId: unknown,
    sourceSetId: unknown,
    value5: unknown,
    value6: unknown,
    preferenceJson: unknown,
    payloadJson: unknown,
    contentHash: unknown,
    now: unknown,
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
    jobId: unknown,
    ownerUserId: unknown,
    entryId: unknown,
    revisionNumber: unknown,
    id: unknown,
    now: unknown,
    nowAgain: unknown,
    analysisDomain: unknown,
    value8: unknown,
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
  bindings: readonly [now: unknown, nowAgain: unknown, ownerUserId: unknown, entryId: unknown, jobId: unknown],
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
    revisionNumber: unknown,
    now: unknown,
    entryId: unknown,
    ownerUserId: unknown,
    active_revision_number: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE user_character_entries SET status='submitted',active_revision_number=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND active_revision_number=?`)
    .bind(...bindings);
}

export function insertProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, desiredGeneration: unknown, value2: unknown, now: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
            INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
            VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
              desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
          `)
    .bind(...bindings);
}

export function insertJobs2(
  db: D1Database,
  bindings: readonly [
    profileJobId: unknown,
    ownerUserId: unknown,
    ownerUserIdAgain: unknown,
    desiredGeneration: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
             progress_total,current_step,retryable,revision,created_at,updated_at)
             VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?)`)
    .bind(...bindings);
}
