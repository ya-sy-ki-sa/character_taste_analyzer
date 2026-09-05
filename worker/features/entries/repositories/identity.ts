/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectCharacterIdentities(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    value1: unknown,
    ownerUserId: unknown,
    analysisDomain: unknown,
    analysisDomainAgain: unknown,
    value5: unknown,
    value6: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT ci.work_id AS workId,ci.id AS characterIdentityId,w.title AS workTitle,
             ci.name AS characterName,w.media_type AS mediaType,
             CASE WHEN ci.name_normalized=? AND w.title_normalized=? THEN 'exact'
                  ELSE 'work_and_character' END AS match
      FROM character_identities ci JOIN works w ON w.id=ci.work_id
      WHERE ci.owner_user_id=? AND ci.analysis_domain=? AND w.analysis_domain=?
        AND ci.name_normalized=? AND w.title_normalized=?
      ORDER BY ci.updated_at DESC,ci.id LIMIT 20
    `)
    .bind(...bindings);
}
