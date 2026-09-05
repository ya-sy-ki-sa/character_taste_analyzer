/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectProfileProjections(
  db: D1Database,
  bindings: readonly [profileProjectionId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT generation FROM profile_projections WHERE id=? AND owner_user_id=? AND status IN ('building','current')`,
    )
    .bind(...bindings);
}

export function selectProfileDimensions(
  db: D1Database,
  bindings: readonly [profileProjectionId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT pd.*, ad.stable_key, ad.label, ad.category FROM profile_dimensions pd
    LEFT JOIN attribute_definitions ad ON ad.id=pd.attribute_definition_id
    WHERE pd.profile_projection_id=? ORDER BY pd.rank_order,pd.id
  `)
    .bind(...bindings);
}

export function selectUserCharacterEntries(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT ci.work_id, w.title AS work_title, ci.id AS identity_id, ci.name AS identity_name,
           cr.id AS representation_id, cr.representation_type, cr.base_representation_id,e.analysis_domain
    FROM user_character_entries e
    JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    JOIN character_representations cr ON cr.id=er.representation_id
    JOIN character_identities ci ON ci.id=cr.character_identity_id
    LEFT JOIN works w ON w.id=ci.work_id
    WHERE e.owner_user_id=? AND e.status='active'
    ORDER BY ci.name,cr.id
  `)
    .bind(...bindings);
}

export function selectValueStanceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT DISTINCT vs.id,vs.orientation,vs.stance,e.analysis_domain,
      COALESCE(ad.label,CASE WHEN instr(vs.target_ref,'.')>0 THEN '未分類の属性' ELSE vs.target_ref END) AS target_ref,
      vs.confidence
    FROM value_stance_assertions vs JOIN analysis_runs ar ON ar.id=vs.analysis_run_id
    JOIN entry_revisions er ON er.id=ar.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id
    LEFT JOIN attribute_definitions ad ON ad.stable_key=vs.target_ref AND ad.status='active'
      AND ad.schema_version_id=(SELECT id FROM attribute_schema_versions WHERE status='active' ORDER BY created_at DESC LIMIT 1)
    WHERE vs.owner_user_id=? AND vs.status IN ('confirmed','corrected') AND e.status='active' AND e.active_revision_number=er.revision_number
    ORDER BY vs.id
  `)
    .bind(...bindings);
}

export function selectPreferenceAssertions(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT DISTINCT pa.representation_id,ad.stable_key,rm.raw_label,pa.confidence,e.analysis_domain
    FROM preference_assertions pa JOIN entry_revisions er ON er.id=pa.entry_revision_id
    JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
    JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id
    LEFT JOIN attribute_definitions ad ON ad.id=pa.attribute_definition_id
    WHERE pa.owner_user_id=? AND pa.status IN ('confirmed','corrected') AND e.status='active'
    ORDER BY pa.representation_id,pa.id
  `)
    .bind(...bindings);
}

export function selectGraphProjectionSnapshots(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT projection_generation FROM graph_projection_snapshots WHERE owner_user_id=? ORDER BY projection_generation DESC LIMIT 1`,
    )
    .bind(...bindings);
}

export function insertGraphProjectionSnapshots(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    profileProjectionId: unknown,
    value3: unknown,
    value4: unknown,
    contentHash: unknown,
    length: unknown,
    lengthAgain: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO graph_projection_snapshots (id,owner_user_id,profile_projection_id,projection_generation,schema_version,content_hash,node_count,edge_count,status,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,'building',?,?)`,
    )
    .bind(...bindings);
}

export function insertGraphProjectionNodes(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    idAgain: unknown,
    type: unknown,
    label: unknown,
    value4: unknown,
    attributesJson: unknown,
    value6: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO graph_projection_nodes (projection_snapshot_id,node_id,node_type,label,weight,payload_json,analysis_domain) VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertGraphProjectionEdges(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    idAgain: unknown,
    source: unknown,
    target: unknown,
    type: unknown,
    value5: unknown,
    value6: unknown,
    value7: unknown,
    value8Json: unknown,
    value9: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO graph_projection_edges (projection_snapshot_id,edge_id,source_node_id,target_node_id,edge_type,directed,weight,confidence,payload_json,analysis_domain) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function selectProjectionRebuildStates(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT desired_generation,built_generation,status FROM projection_rebuild_states WHERE owner_user_id=?`)
    .bind(...bindings);
}

export function selectGraphProjectionSnapshots2(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    SELECT gps.id,gps.profile_projection_id,pp.generation,gps.content_hash,gps.node_count,gps.edge_count
    FROM graph_projection_snapshots gps JOIN profile_projections pp ON pp.id=gps.profile_projection_id
    WHERE gps.owner_user_id=? AND gps.status='current'
  `)
    .bind(...bindings);
}

export function selectGraphProjectionNodes(
  db: D1Database,
  bindings: readonly [id: unknown, analysisDomain: unknown, nodes: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT node_id,node_type,label,weight,payload_json FROM graph_projection_nodes WHERE projection_snapshot_id=? AND analysis_domain=? ORDER BY weight DESC,node_id LIMIT ?`,
    )
    .bind(...bindings);
}

export function selectAttributeDefinitions(
  db: D1Database,
  bindings: readonly [analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT ad.stable_key,ad.label FROM attribute_definitions ad
      JOIN attribute_schema_versions av ON av.id=ad.schema_version_id
      WHERE ad.status='active' AND av.status='active' AND av.analysis_domain=?
      ORDER BY ad.stable_key
    `)
    .bind(...bindings);
}

export function selectGraphProjectionEdges(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    analysisDomain: unknown,
    idAgain: unknown,
    analysisDomainAgain: unknown,
    nodes: unknown,
    idAgainAgain: unknown,
    analysisDomainAgainAgain: unknown,
    nodesAgain: unknown,
    edges: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`SELECT edge_id,source_node_id,target_node_id,edge_type,directed,weight,confidence,payload_json
       FROM graph_projection_edges WHERE projection_snapshot_id=? AND analysis_domain=?
         AND source_node_id IN (SELECT node_id FROM graph_projection_nodes WHERE projection_snapshot_id=? AND analysis_domain=? ORDER BY weight DESC,node_id LIMIT ?)
         AND target_node_id IN (SELECT node_id FROM graph_projection_nodes WHERE projection_snapshot_id=? AND analysis_domain=? ORDER BY weight DESC,node_id LIMIT ?)
       ORDER BY weight DESC,confidence DESC,edge_id LIMIT ?`)
    .bind(...bindings);
}
