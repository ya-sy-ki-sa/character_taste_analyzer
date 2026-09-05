import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GraphProjection } from "../../../shared/contracts/profile-response";
import { graphNodeLabel, representationTypeLabel } from "../../../shared/presentation-labels";
import { responseChannelLabel } from "../../../shared/response-channels";
import { valueStanceLabel } from "../../../shared/value-stance-labels";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/graph";

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
    repository.selectProfileProjections(env.DB, [profileProjectionId, ownerUserId]),
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
    analysis_domain: AnalysisDomain;
  }>(repository.selectProfileDimensions(env.DB, [profileProjectionId]));
  const entries = await all<{
    work_id: string | null;
    work_title: string | null;
    identity_id: string;
    identity_name: string;
    representation_id: string;
    representation_type: string;
    base_representation_id: string | null;
    analysis_domain: AnalysisDomain;
  }>(repository.selectUserCharacterEntries(env.DB, [ownerUserId]));
  const stances = await all<{
    id: string;
    orientation: string;
    stance: string;
    target_ref: string;
    confidence: number;
    analysis_domain: AnalysisDomain;
  }>(repository.selectValueStanceAssertions(env.DB, [ownerUserId]));
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const putNode = nodeMapWriter(nodes);
  const putEdge = edgeMapWriter(edges);
  for (const domain of ["standard", "dark"] as const)
    putNode({ id: `u:${domain}`, type: "user", label: "あなた", weight: 1, attributes: { analysisDomain: domain } });
  for (const dimension of dimensions) {
    const rawHash = dimension.attribute_definition_id
      ? null
      : (await sha256Hex(normalizeIdentityPart(dimension.raw_label ?? ""))).slice(0, 24);
    const attributeNodeId = dimension.stable_key
      ? `a:${dimension.analysis_domain}:${dimension.stable_key}`
      : `ra:${dimension.analysis_domain}:${rawHash}`;
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
        analysisDomain: dimension.analysis_domain,
      },
    });
    if (dimension.positive_score > 0)
      putEdge({
        id: `like:${dimension.id}`,
        source: `u:${dimension.analysis_domain}`,
        target: attributeNodeId,
        type: "likes",
        directed: true,
        weight: dimension.positive_score,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: { profileDimensionId: dimension.id, analysisDomain: dimension.analysis_domain },
      });
    if (dimension.negative_score > 0)
      putEdge({
        id: `dislike:${dimension.id}`,
        source: `u:${dimension.analysis_domain}`,
        target: attributeNodeId,
        type: "dislikes",
        directed: true,
        weight: dimension.negative_score,
        confidence: dimension.confidence,
        evidenceCount: dimension.evidence_count,
        attributes: { profileDimensionId: dimension.id, analysisDomain: dimension.analysis_domain },
      });
    if (dimension.response_channel) {
      const responseNode = `rc:${dimension.analysis_domain}:${dimension.response_channel}`;
      putNode({
        id: responseNode,
        type: "response_channel",
        label: responseChannelLabel(dimension.response_channel),
        weight: maximum,
        attributes: { analysisDomain: dimension.analysis_domain },
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
        attributes: { analysisDomain: dimension.analysis_domain },
      });
    }
    let condition: Record<string, unknown> = {};
    try {
      condition = JSON.parse(dimension.condition_json) as Record<string, unknown>;
    } catch {
      condition = {};
    }
    if (condition.scope) {
      const conditionNode = `ctx:${dimension.analysis_domain}:${dimension.condition_hash.slice(0, 24)}`;
      putNode({
        id: conditionNode,
        type: "context",
        label: String(condition.scope),
        weight: maximum,
        attributes: { ...condition, analysisDomain: dimension.analysis_domain },
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
        attributes: { analysisDomain: dimension.analysis_domain },
      });
    }
  }
  for (const entry of entries) {
    const identityNode = `ci:${entry.analysis_domain}:${entry.identity_id}`;
    const representationNode = `cr:${entry.analysis_domain}:${entry.representation_id}`;
    putNode({
      id: identityNode,
      type: "character_identity",
      label: entry.identity_name,
      weight: 0.7,
      attributes: { analysisDomain: entry.analysis_domain },
    });
    putNode({
      id: representationNode,
      type: "representation",
      label: `${entry.identity_name}（${representationTypeLabel(entry.representation_type)}）`,
      weight: 0.65,
      attributes: { representationType: entry.representation_type, analysisDomain: entry.analysis_domain },
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
      attributes: { analysisDomain: entry.analysis_domain },
    });
    if (entry.work_id) {
      const workNode = `w:${entry.analysis_domain}:${entry.work_id}`;
      putNode({
        id: workNode,
        type: "work",
        label: entry.work_title ?? "作品",
        weight: 0.6,
        attributes: { analysisDomain: entry.analysis_domain },
      });
      putEdge({
        id: `work:${entry.identity_id}`,
        source: identityNode,
        target: workNode,
        type: "in_work",
        directed: true,
        weight: 0.7,
        confidence: 1,
        evidenceCount: 1,
        attributes: { analysisDomain: entry.analysis_domain },
      });
    }
    if (entry.base_representation_id) {
      const baseNode = `cr:${entry.analysis_domain}:${entry.base_representation_id}`;
      putNode({
        id: baseNode,
        type: "representation",
        label: `${entry.identity_name}（基本像）`,
        weight: 0.55,
        attributes: { representationType: "canonical_whole", analysisDomain: entry.analysis_domain },
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
        attributes: { analysisDomain: entry.analysis_domain },
      });
    }
  }
  const assertionLinks = await all<{
    representation_id: string;
    stable_key: string | null;
    raw_label: string;
    confidence: number;
    analysis_domain: AnalysisDomain;
  }>(repository.selectPreferenceAssertions(env.DB, [ownerUserId]));
  for (const link of assertionLinks) {
    const target = link.stable_key
      ? `a:${link.analysis_domain}:${link.stable_key}`
      : `ra:${link.analysis_domain}:${(await sha256Hex(normalizeIdentityPart(link.raw_label))).slice(0, 24)}`;
    if (!nodes.has(target) || !nodes.has(`cr:${link.analysis_domain}:${link.representation_id}`)) continue;
    putEdge({
      id: `attribute:${link.representation_id}:${target}`,
      source: `cr:${link.analysis_domain}:${link.representation_id}`,
      target,
      type: "has_attribute",
      directed: true,
      weight: clamp(link.confidence),
      confidence: clamp(link.confidence),
      evidenceCount: 1,
      attributes: { analysisDomain: link.analysis_domain },
    });
  }
  for (const stance of stances) {
    const hash = (
      await sha256Hex(`${stance.orientation}\u0000${stance.stance}\u0000${normalizeIdentityPart(stance.target_ref)}`)
    ).slice(0, 24);
    const nodeId = `vs:${stance.analysis_domain}:${stance.orientation}:${stance.stance}:${hash}`;
    putNode({
      id: nodeId,
      type: "value_stance",
      label: `${stance.target_ref}：${valueStanceLabel(stance.stance)}`,
      weight: stance.confidence,
      attributes: { orientation: stance.orientation, stance: stance.stance, analysisDomain: stance.analysis_domain },
    });
    putEdge({
      id: `stance:${stance.id}`,
      source: `u:${stance.analysis_domain}`,
      target: nodeId,
      type: "has_stance",
      directed: true,
      weight: stance.confidence,
      confidence: stance.confidence,
      evidenceCount: 1,
      attributes: { analysisDomain: stance.analysis_domain },
    });
  }
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const contentHash = await sha256Hex(JSON.stringify({ nodes: sortedNodes, edges: sortedEdges }));
  const previous = await first<{ projection_generation: number }>(
    repository.selectGraphProjectionSnapshots(env.DB, [ownerUserId]),
  );
  const id = crypto.randomUUID();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    repository.insertGraphProjectionSnapshots(env.DB, [
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
    ]),
  ];
  for (const node of sortedNodes)
    statements.push(
      repository.insertGraphProjectionNodes(env.DB, [
        id,
        node.id,
        node.type,
        node.label,
        clamp(node.weight),
        JSON.stringify(node.attributes),
        node.attributes.analysisDomain === "dark" ? "dark" : "standard",
      ]),
    );
  for (const edge of sortedEdges)
    statements.push(
      repository.insertGraphProjectionEdges(env.DB, [
        id,
        edge.id,
        edge.source,
        edge.target,
        edge.type,
        edge.directed ? 1 : 0,
        clamp(edge.weight),
        clamp(edge.confidence),
        JSON.stringify({ ...edge.attributes, evidenceCount: edge.evidenceCount }),
        edge.attributes.analysisDomain === "dark" ? "dark" : "standard",
      ]),
    );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_GRAPH_REBUILD_FAILED");
  return id;
}

export async function loadCurrentGraph(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain = "standard",
  detail: GraphProjection["detail"] = "standard",
): Promise<GraphProjection | null> {
  const freshness = await first<{ desired_generation: number; built_generation: number; status: string }>(
    repository.selectProjectionRebuildStates(env.DB, [ownerUserId]),
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
  }>(repository.selectGraphProjectionSnapshots2(env.DB, [ownerUserId]));
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
  }>(repository.selectGraphProjectionNodes(env.DB, [snapshot.id, analysisDomain, limits.nodes]));
  const attributeRows = await all<{ stable_key: string; label: string }>(
    repository.selectAttributeDefinitions(env.DB, [analysisDomain]),
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
    repository.selectGraphProjectionEdges(env.DB, [
      snapshot.id,
      analysisDomain,
      snapshot.id,
      analysisDomain,
      limits.nodes,
      snapshot.id,
      analysisDomain,
      limits.nodes,
      limits.edges,
    ]),
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
