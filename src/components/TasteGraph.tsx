import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import type { GraphProjection } from "../../shared/schemas";

const colors: Record<string, string> = {
  user: "#7c5cff",
  work: "#4f8fd8",
  character_identity: "#27a58b",
  representation: "#76b8a7",
  attribute: "#e58a45",
  raw_attribute: "#d5a14d",
  response_channel: "#9c71c7",
  value_stance: "#d0658b",
  context: "#788497",
  profile_pattern: "#5c74b8",
};

export function TasteGraph({ projection }: { projection: GraphProjection }) {
  const container = useRef<HTMLDivElement>(null);
  const [minimum, setMinimum] = useState(0.2);
  const [selected, setSelected] = useState<{ label: string; type: string; attributes: Record<string, unknown> }>();

  useEffect(() => {
    if (!container.current) return;
    const graph = new MultiDirectedGraph({ allowSelfLoops: false });
    const visible = projection.nodes.filter((node) => node.weight >= minimum || node.type === "user");
    const nodeIds = new Set(visible.map((node) => node.id));
    visible.forEach((node, index) => {
      const angle = (index / Math.max(1, visible.length)) * Math.PI * 2;
      graph.addNode(node.id, {
        label: node.label,
        x: Math.cos(angle),
        y: Math.sin(angle),
        size: Math.min(24, 6 + 18 * Math.sqrt(node.weight)),
        color: colors[node.type] ?? "#7a8494",
        nodeType: node.type,
        payload: node.attributes,
      });
    });
    for (const edge of projection.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || graph.hasEdge(edge.id)) continue;
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
        size: 0.5 + edge.weight * 2,
        color: edge.type === "dislikes" ? "#c75c6d" : "#a7afbd",
        edgeType: edge.type,
      });
    }
    const renderer = new Sigma(graph, container.current, { renderEdgeLabels: false, allowInvalidContainer: true });
    renderer.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      setSelected({
        label: String(attrs.label),
        type: String(attrs.nodeType),
        attributes: (attrs.payload ?? {}) as Record<string, unknown>,
      });
    });
    const layout =
      graph.order > 1
        ? new FA2LayoutSupervisor(graph, {
            settings: {
              ...forceAtlas2.inferSettings(graph),
              barnesHutOptimize: graph.order > 300,
              barnesHutTheta: 0.6,
              gravity: 1,
              scalingRatio: 8,
              slowDown: 2,
              edgeWeightInfluence: 0.5,
            },
            getEdgeWeight: "size",
          })
        : null;
    layout?.start();
    const timer = window.setTimeout(() => layout?.stop(), graph.order <= 300 ? 2_000 : 5_000);
    return () => {
      window.clearTimeout(timer);
      layout?.kill();
      renderer.kill();
    };
  }, [minimum, projection]);

  return (
    <div className="graph-shell">
      <div className="graph-toolbar">
        <label>
          <span>表示する接続の強さ</span>
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            value={minimum}
            onChange={(event) => setMinimum(Number(event.target.value))}
          />
          <b>{Math.round(minimum * 100)}%</b>
        </label>
        <small>
          {projection.nodes.length}ノード / {projection.edges.length}エッジ
        </small>
      </div>
      <div className="graph-stage" ref={container} role="application" aria-label="嗜好グラフ" />
      {selected && (
        <aside className="graph-selection">
          <strong>{selected.label}</strong>
          <small>{selected.type}</small>
          {Object.entries(selected.attributes).map(([key, value]) => (
            <span key={key}>
              {key}: {String(value)}
            </span>
          ))}
        </aside>
      )}
      <p className="muted">
        色はノードの種類を示します。善悪の価値序列ではありません。配置と接続探索はブラウザ内のGraphology／ForceAtlas2／Sigma.jsで行い、嗜好スコアは変更しません。
      </p>
    </div>
  );
}
