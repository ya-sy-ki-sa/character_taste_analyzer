import { graphNodeLabel, representationTypeLabel } from "../../shared/presentation-labels";
import { responseChannelLabel } from "../../shared/response-channels";
import type { GraphProjection } from "../../shared/schemas";
import { valueStanceLabel } from "../../shared/value-stance-labels";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";

type GraphNode = GraphProjection["nodes"][number];
type GraphEdge = GraphProjection["edges"][number];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nodeMapWriter(nodes: Map<string, GraphNode>) {
  return (node: GraphNode) => {
    const current = nodes.get(node.id);
    if (!current || node.weight > current.weight) nodes.set(node.id, node);
  };
}

function edgeMapWriter(edges: Map<string, GraphEdge>) {
  return (edge: GraphEdge) => {
    const current = edges.get(edge.id);
    if (!current || edge.weight > current.weight) edges.set(edge.id, edge);
  };
}

export async function rebuildGraphProjection(
  env: Env,
  ownerUserId: string,
  profileProjectionId: string,
): Promise<string> {
  const profile = await first<{ generation: number }>(
    env.DB.prepare(
      `SELECT generation FROM profile_projections WHERE id=? AND owner_user_id=? AND status IN ('building','current')`,
    ).bind(profileProjectionId, ownerUserId),
  );
  if (!profile) throw new Error("PROFILE_NOT_CURRENT");
  const dimensions = await all<{
    id: string;
    attribute_definition_id: string | null;
    raw_label: string | null;
    stable_key: string | null;
    label: string | null;
    category: string | null;
    response_channel: string | null;
    condition_hash: string;
    condition_json: string;
    positive_score: number;
    negative_score: number;
    confidence: number;
    evidence_count: number;
    classification: string;
  }>(
    env.DB.prepare(`
    SELECT pd.*, ad.stable_key, ad.label, ad.category FROM profile_dimensions pd
    LEFT JOIN attribute_definitions ad ON ad.id=pd.attribute_definition_id
    WHERE pd.profile_projection_id=? ORDER BY pd.rank_order,pd.id
  `).bind(profileProjectionId),
  );
  const entries = await all<{
    work_id: string | null;
    work_title: string | null;
    identity_id: string;
    identity_name: string;
    representation_id: string;
    representation_type: string;
    base_representation_id: string | null;
  }>(
    env.DB.prepare(`
    SELECT ci.work_id, w.title AS work_title, ci.id AS identity_id, ci.name AS identity_name,
           cr.id AS representation_id, cr.representation_type, cr.base_representation_id
    FROM user_character_entries e
    JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    JOIN character_representations cr ON cr.id=er.representation_id
    JOIN character_identities ci ON ci.id=cr.character_identity_id
    LEFT JOIN works w ON w.id=ci.work_id
    WHERE e.owner_user_id=? AND e.status='active' AND e.deleted_at IS NULL
    ORDER BY ci.name,cr.id
  `).bind(ownerUserId),
  );
  const stances = await all<{
    id: string;
    orientation: string;
    stance: string;
    target_ref: string;
    confidence: number;
  }>(
    env.DB.prepare(`
    SELECT DISTINCT vs.id,vs.orientation,vs.stance,
      COALESCE(ad.label,CASE WHEN instr(vs.target_ref,'.')>0 THEN '未分類の属性' ELSE vs.target_ref END) AS target_ref,
      vs.confidence
    FROM value_stance_assertions vs JOIN analysis_runs ar ON ar.id=vs.analysis_run_id
    JOIN entry_revisions er ON er.id=ar.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id
    LEFT JOIN attribute_definitions ad ON ad.stable_key=vs.target_ref AND ad.status='active'
      AND ad.schema_version_id=(SELECT id FROM attribute_schema_versions WHERE status='active' ORDER BY created_at DESC LIMIT 1)
    WHERE vs.owner_user_id=? AND vs.status IN ('confirmed','corrected') AND e.status='active' AND e.active_revision_number=er.revision_number
    ORDER BY vs.id
  `).bind(ownerUserId),
  );
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const putNode = nodeMapWriter(nodes);
  const putEdge = edgeMapWriter(edges);
  putNode({ id: "u:self", type: "user", label: "あなた", weight: 1, attributes: {} });
  for (const dimension of dimensions) {
    const rawHash = dimension.attribute_definition_id
      ? null
      : (await sha256Hex(normalizeIdentityPart(dimension.raw_label ?? ""))).slice(0, 24);
    const attributeNodeId = dimension.stable_key ? `a:${dimension.stable_key}` : `ra:${rawHash}`;
    const label = dimension.label ?? dimension.raw_label ?? "未分類属性";
    const maximum = Math.max(dimension.positive_score, dimension.negative_score);
    putNode({
      id: attributeNodeId,
      type: dimension.stable_key ? "attribute" : "raw_attribute",
      label,
      weight: maximum,
      attributes: {
        stableKey: dimension.stable_key,
        category: dimension.category ?? "other",
        classification: dimension.classification,
      },
    });
    if (dimension.positive_score > 0)
      putEdge({
        id: `like:${dimension.id}`,
        source: "u:self",
        target: attributeNodeId,
        type: "likes",
        directed: true,
        weight: dimension.positive_score,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: { profileDimensionId: dimension.id },
      });
    if (dimension.negative_score > 0)
      putEdge({
        id: `dislike:${dimension.id}`,
        source: "u:self",
        target: attributeNodeId,
        type: "dislikes",
        directed: true,
        weight: dimension.negative_score,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: { profileDimensionId: dimension.id },
      });
    if (dimension.response_channel) {
      const responseNode = `rc:${dimension.response_channel}`;
      putNode({
        id: responseNode,
        type: "response_channel",
        label: responseChannelLabel(dimension.response_channel),
        weight: maximum,
        attributes: {},
      });
      putEdge({
        id: `response:${dimension.id}`,
        source: attributeNodeId,
        target: responseNode,
        type: "responds_via",
        directed: true,
        weight: maximum,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: {},
      });
    }
    let condition: Record<string, unknown> = {};
    try {
      condition = JSON.parse(dimension.condition_json) as Record<string, unknown>;
    } catch {
      condition = {};
    }
    if (condition.scope) {
      const conditionNode = `ctx:${dimension.condition_hash.slice(0, 24)}`;
      putNode({
        id: conditionNode,
        type: "context",
        label: String(condition.scope),
        weight: maximum,
        attributes: condition,
      });
      putEdge({
        id: `condition:${dimension.id}`,
        source: attributeNodeId,
        target: conditionNode,
        type: "conditioned_by",
        directed: true,
        weight: maximum,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: {},
      });
    }
  }
  for (const entry of entries) {
    const identityNode = `ci:${entry.identity_id}`;
    const representationNode = `cr:${entry.representation_id}`;
    putNode({ id: identityNode, type: "character_identity", label: entry.identity_name, weight: 0.7, attributes: {} });
    putNode({
      id: representationNode,
      type: "representation",
      label: `${entry.identity_name}（${representationTypeLabel(entry.representation_type)}）`,
      weight: 0.65,
      attributes: { representationType: entry.representation_type },
    });
    putEdge({
      id: `represented:${entry.representation_id}`,
      source: identityNode,
      target: representationNode,
      type: "represented_as",
      directed: true,
      weight: 0.7,
      confidence: 1,
      evidenceCount: 1,
      attributes: {},
    });
    if (entry.work_id) {
      const workNode = `w:${entry.work_id}`;
      putNode({ id: workNode, type: "work", label: entry.work_title ?? "作品", weight: 0.6, attributes: {} });
      putEdge({
        id: `work:${entry.identity_id}`,
        source: identityNode,
        target: workNode,
        type: "in_work",
        directed: true,
        weight: 0.7,
        confidence: 1,
        evidenceCount: 1,
        attributes: {},
      });
    }
    if (entry.base_representation_id) {
      const baseNode = `cr:${entry.base_representation_id}`;
      putNode({
        id: baseNode,
        type: "representation",
        label: `${entry.identity_name}（基本像）`,
        weight: 0.55,
        attributes: { representationType: "canonical_whole" },
      });
      putEdge({
        id: `derived:${entry.representation_id}`,
        source: representationNode,
        target: baseNode,
        type: "derived_from",
        directed: true,
        weight: 1,
        confidence: 1,
        evidenceCount: 1,
        attributes: {},
      });
    }
  }
  const assertionLinks = await all<{
    representation_id: string;
    stable_key: string | null;
    raw_label: string;
    confidence: number;
  }>(
    env.DB.prepare(`
    SELECT DISTINCT pa.representation_id,ad.stable_key,rm.raw_label,pa.confidence
    FROM preference_assertions pa JOIN entry_revisions er ON er.id=pa.entry_revision_id
    JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
    JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id
    LEFT JOIN attribute_definitions ad ON ad.id=pa.attribute_definition_id
    WHERE pa.owner_user_id=? AND pa.status IN ('confirmed','corrected') AND e.status='active'
    ORDER BY pa.representation_id,pa.id
  `).bind(ownerUserId),
  );
  for (const link of assertionLinks) {
    const target = link.stable_key
      ? `a:${link.stable_key}`
      : `ra:${(await sha256Hex(normalizeIdentityPart(link.raw_label))).slice(0, 24)}`;
    if (!nodes.has(target) || !nodes.has(`cr:${link.representation_id}`)) continue;
    putEdge({
      id: `attribute:${link.representation_id}:${target}`,
      source: `cr:${link.representation_id}`,
      target,
      type: "has_attribute",
      directed: true,
      weight: clamp(link.confidence),
      confidence: clamp(link.confidence),
      evidenceCount: 1,
      attributes: {},
    });
  }
  for (const stance of stances) {
    const hash = (
      await sha256Hex(`${stance.orientation}\u0000${stance.stance}\u0000${normalizeIdentityPart(stance.target_ref)}`)
    ).slice(0, 24);
    const nodeId = `vs:${stance.orientation}:${stance.stance}:${hash}`;
    putNode({
      id: nodeId,
      type: "value_stance",
      label: `${stance.target_ref}：${valueStanceLabel(stance.stance)}`,
      weight: stance.confidence,
      attributes: { orientation: stance.orientation, stance: stance.stance },
    });
    putEdge({
      id: `stance:${stance.id}`,
      source: "u:self",
      target: nodeId,
      type: "has_stance",
      directed: true,
      weight: stance.confidence,
      confidence: stance.confidence,
      evidenceCount: 1,
      attributes: {},
    });
  }
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const contentHash = await sha256Hex(JSON.stringify({ nodes: sortedNodes, edges: sortedEdges }));
  const previous = await first<{ projection_generation: number }>(
    env.DB.prepare(
      `SELECT projection_generation FROM graph_projection_snapshots WHERE owner_user_id=? ORDER BY projection_generation DESC LIMIT 1`,
    ).bind(ownerUserId),
  );
  const id = crypto.randomUUID();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO graph_projection_snapshots (id,owner_user_id,profile_projection_id,projection_generation,schema_version,content_hash,node_count,edge_count,status,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,'building',?,?)`,
    ).bind(
      id,
      ownerUserId,
      profileProjectionId,
      (previous?.projection_generation ?? 0) + 1,
      "1.0",
      contentHash,
      sortedNodes.length,
      sortedEdges.length,
      now,
      now,
    ),
  ];
  for (const node of sortedNodes)
    statements.push(
      env.DB.prepare(
        `INSERT INTO graph_projection_nodes (projection_snapshot_id,node_id,node_type,label,weight,payload_json) VALUES (?,?,?,?,?,?)`,
      ).bind(id, node.id, node.type, node.label, clamp(node.weight), JSON.stringify(node.attributes)),
    );
  for (const edge of sortedEdges)
    statements.push(
      env.DB.prepare(
        `INSERT INTO graph_projection_edges (projection_snapshot_id,edge_id,source_node_id,target_node_id,edge_type,directed,weight,confidence,payload_json) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        edge.id,
        edge.source,
        edge.target,
        edge.type,
        edge.directed ? 1 : 0,
        clamp(edge.weight),
        clamp(edge.confidence),
        JSON.stringify({ ...edge.attributes, evidenceCount: edge.evidenceCount }),
      ),
    );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_GRAPH_REBUILD_FAILED");
  return id;
}

export async function loadCurrentGraph(
  env: Env,
  ownerUserId: string,
  detail: GraphProjection["detail"] = "standard",
): Promise<GraphProjection | null> {
  const freshness = await first<{ desired_generation: number; built_generation: number; status: string }>(
    env.DB.prepare(
      `SELECT desired_generation,built_generation,status FROM projection_rebuild_states WHERE owner_user_id=?`,
    ).bind(ownerUserId),
  );
  if (freshness && (freshness.desired_generation !== freshness.built_generation || freshness.status !== "current"))
    return null;
  const snapshot = await first<{
    id: string;
    profile_projection_id: string;
    generation: number;
    content_hash: string;
    node_count: number;
    edge_count: number;
  }>(
    env.DB.prepare(`
    SELECT gps.id,gps.profile_projection_id,pp.generation,gps.content_hash,gps.node_count,gps.edge_count
    FROM graph_projection_snapshots gps JOIN profile_projections pp ON pp.id=gps.profile_projection_id
    WHERE gps.owner_user_id=? AND gps.status='current'
  `).bind(ownerUserId),
  );
  if (!snapshot) return null;
  const limits =
    detail === "summary"
      ? { nodes: 300, edges: 1200 }
      : detail === "expanded"
        ? { nodes: 3000, edges: 15000 }
        : { nodes: 1000, edges: 5000 };
  const nodeRows = await all<{
    node_id: string;
    node_type: string;
    label: string;
    weight: number;
    payload_json: string;
  }>(
    env.DB.prepare(
      `SELECT node_id,node_type,label,weight,payload_json FROM graph_projection_nodes WHERE projection_snapshot_id=? ORDER BY weight DESC,node_id LIMIT ?`,
    ).bind(snapshot.id, limits.nodes),
  );
  const attributeRows = await all<{ stable_key: string; label: string }>(
    env.DB.prepare(`
      SELECT ad.stable_key,ad.label FROM attribute_definitions ad
      JOIN attribute_schema_versions av ON av.id=ad.schema_version_id
      WHERE ad.status='active' AND av.status='active'
      ORDER BY ad.stable_key
    `),
  );
  const attributeLabels = new Map(attributeRows.map((row) => [row.stable_key, row.label]));
  const included = new Set(nodeRows.map((node) => node.node_id));
  const edgeRows = await all<{
    edge_id: string;
    source_node_id: string;
    target_node_id: string;
    edge_type: string;
    directed: number;
    weight: number;
    confidence: number;
    payload_json: string;
  }>(
    env.DB.prepare(
      `SELECT edge_id,source_node_id,target_node_id,edge_type,directed,weight,confidence,payload_json
       FROM graph_projection_edges WHERE projection_snapshot_id=?
         AND source_node_id IN (SELECT node_id FROM graph_projection_nodes WHERE projection_snapshot_id=? ORDER BY weight DESC,node_id LIMIT ?)
         AND target_node_id IN (SELECT node_id FROM graph_projection_nodes WHERE projection_snapshot_id=? ORDER BY weight DESC,node_id LIMIT ?)
       ORDER BY weight DESC,confidence DESC,edge_id LIMIT ?`,
    ).bind(snapshot.id, snapshot.id, limits.nodes, snapshot.id, limits.nodes, limits.edges),
  );
  const edges = edgeRows.filter((edge) => included.has(edge.source_node_id) && included.has(edge.target_node_id));
  return {
    schemaVersion: "1.0",
    projectionId: snapshot.id,
    profileGeneration: snapshot.generation,
    contentHash: snapshot.content_hash,
    detail,
    nodes: nodeRows.map((node) => {
      const attributes = JSON.parse(node.payload_json) as Record<string, unknown>;
      const view = { id: node.node_id, type: node.node_type, label: node.label, attributes };
      return {
        ...view,
        label: graphNodeLabel(view, attributeLabels),
        weight: node.weight,
      };
    }),
    edges: edges.map((edge) => {
      const payload = JSON.parse(edge.payload_json) as Record<string, unknown>;
      return {
        id: edge.edge_id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        type: edge.edge_type,
        directed: edge.directed === 1,
        weight: edge.weight,
        confidence: edge.confidence,
        evidenceCount: Number(payload.evidenceCount ?? 0),
        attributes: payload,
      };
    }),
    truncated: snapshot.node_count > nodeRows.length || snapshot.edge_count > edges.length,
    truncationReason:
      snapshot.node_count > nodeRows.length || snapshot.edge_count > edges.length
        ? `${detail}の表示上限を適用しました`
        : null,
  };
}
