import type { AnalysisDomain } from "../../../../shared/analysis-domain";

export function selectReusableIdentity(
  db: D1Database,
  bindings: readonly [
    characterIdentityId: string,
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    normalizedCharacterName: string,
    workId: string | null,
    workIdAgain: string | null,
    normalizedWorkTitle: string,
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

export function insertWork(
  db: D1Database,
  bindings: readonly [
    workId: string,
    ownerUserId: string,
    workTitle: string,
    normalizedTitle: string,
    mediaType: string | null,
    createdAt: string,
    updatedAt: string,
    analysisDomain: AnalysisDomain,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO works (id,owner_user_id,title,title_normalized,media_type,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertIdentity(
  db: D1Database,
  bindings: readonly [
    identityId: string,
    originType: "original" | "existing",
    ownerUserId: string,
    workId: string | null,
    characterName: string,
    normalizedName: string,
    createdAt: string,
    updatedAt: string,
    analysisDomain: AnalysisDomain,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_identities (id,origin_type,owner_user_id,work_id,name,name_normalized,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertBaseRepresentation(
  db: D1Database,
  bindings: readonly [
    representationId: string,
    identityId: string,
    ownerUserId: string,
    scopeDescription: string,
    sourceDescription: string | null,
    createdAt: string,
    updatedAt: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,NULL,?,'canonical_whole','official','whole',?,NULL,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertTargetRepresentation(
  db: D1Database,
  bindings: readonly [
    representationId: string,
    identityId: string,
    baseRepresentationId: string | null,
    ownerUserId: string,
    representationType: string,
    canonicality: string,
    scopeType: string,
    scopeDescription: string,
    transformationSummary: string | null,
    sourceDescription: string | null,
    createdAt: string,
    updatedAt: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertInputSourceSet(
  db: D1Database,
  bindings: readonly [
    sourceSetId: string,
    ownerUserId: string,
    contentHash: string,
    createdAt: string,
    updatedAt: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_sets (id,owner_user_id,purpose,content_hash,created_at,updated_at) VALUES (?,?,'character_understanding',?,?,?)`,
    )
    .bind(...bindings);
}

export function insertInputSource(
  db: D1Database,
  bindings: readonly [
    documentId: string,
    ownerUserId: string,
    title: string,
    citationJson: string,
    byteSize: number,
    contentHash: string,
    locatorJson: string,
    text: string,
    tokenEstimate: number,
    createdAt: string,
    updatedAt: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,?,'user_text',?,'user_supplied','text/plain',?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertInputSourceSetItem(
  db: D1Database,
  bindings: readonly [sourceSetId: string, documentId: string, priority: number],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,?,'user_definition')`,
    )
    .bind(...bindings);
}
