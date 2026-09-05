import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import type { GraphProjection } from "../../shared/contracts/profile-response";
import { graphEdgeTypeLabel, graphNodeLabel, graphNodeTypeLabel } from "../../shared/presentation-labels";
import { graphAttributeEntries } from "../lib/graph-labels";

const colorRoles: Record<string, string> = {
  user: "--graph-user",
  work: "--graph-work",
  character_identity: "--graph-identity",
  representation: "--graph-representation",
  attribute: "--graph-attribute",
  raw_attribute: "--graph-raw-attribute",
  response_channel: "--graph-response",
  value_stance: "--graph-value",
  context: "--graph-context",
};

export function TasteGraph({ projection }: { projection: GraphProjection }) {
  const container = useRef<HTMLDivElement>(null);
  const [minimum, setMinimum] = useState(0.2);
  const [selected, setSelected] = useState<{
    id: string;
    label: string;
    type: string;
    attributes: Record<string, unknown>;
  }>();
  const visibleNodes = useMemo(
    () => projection.nodes.filter((node) => node.weight >= minimum || node.type === "user"),
    [minimum, projection.nodes],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const nodeLabels = useMemo(
    () => new Map(projection.nodes.map((node) => [node.id, graphNodeLabel(node)])),
    [projection.nodes],
  );
  const visibleEdges = useMemo(
    () => projection.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [projection.edges, visibleIds],
  );

  useEffect(() => {
    if (!container.current) return;
    const styles = getComputedStyle(container.current);
    const graphColor = (role: string, fallback: string) => styles.getPropertyValue(role).trim() || fallback;
    const graph = new MultiDirectedGraph({ allowSelfLoops: false });
    const visible = visibleNodes;
    const nodeIds = new Set(visible.map((node) => node.id));
    visible.forEach((node, index) => {
      const angle = (index / Math.max(1, visible.length)) * Math.PI * 2;
      graph.addNode(node.id, {
        label: nodeLabels.get(node.id) ?? "不明な項目",
        x: Math.cos(angle),
        y: Math.sin(angle),
        size: Math.min(24, 6 + 18 * Math.sqrt(node.weight)),
        color: graphColor(colorRoles[node.type] ?? "--graph-context", "#8b9498"),
        nodeType: node.type,
        payload: node.attributes,
      });
    });
    for (const edge of projection.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || graph.hasEdge(edge.id)) continue;
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
        size: 0.5 + edge.weight * 2,
        color:
          edge.type === "dislikes"
            ? graphColor("--graph-edge-negative", "#c7756b")
            : graphColor("--graph-edge", "#a7afbd"),
        edgeType: edge.type,
      });
    }
    const labelColor = getComputedStyle(container.current).color;
    const renderer = new Sigma(graph, container.current, {
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      labelColor: { color: labelColor },
    });
    renderer.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      setSelected({
        id: node,
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
  }, [nodeLabels, projection, visibleNodes]);

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
      <div className="graph-stage" ref={container} role="application" aria-label="好みのグラフ" />
      {selected && (
        <aside className="graph-selection">
          <strong>{selected.label}</strong>
          <small>{graphNodeTypeLabel(selected.type)}</small>
          {graphAttributeEntries(selected.attributes).map(([key, value]) => (
            <span key={key}>
              {key}：{value}
            </span>
          ))}
        </aside>
      )}
      <details className="graph-table-alternative">
        <summary>キーボード操作用のノード・エッジ表</summary>
        <div className="table-scroll">
          <table>
            <caption>表示中のノード</caption>
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">種類</th>
                <th scope="col">重み</th>
              </tr>
            </thead>
            <tbody>
              {visibleNodes.map((node) => (
                <tr key={node.id}>
                  <th scope="row">
                    <button
                      type="button"
                      onClick={() =>
                        setSelected({ id: node.id, label: node.label, type: node.type, attributes: node.attributes })
                      }
                    >
                      {nodeLabels.get(node.id) ?? "不明な項目"}
                    </button>
                  </th>
                  <td>{graphNodeTypeLabel(node.type)}</td>
                  <td>{Math.round(node.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-scroll">
          <table>
            <caption>表示中のエッジ</caption>
            <thead>
              <tr>
                <th scope="col">接続元</th>
                <th scope="col">関係</th>
                <th scope="col">接続先</th>
                <th scope="col">重み</th>
              </tr>
            </thead>
            <tbody>
              {visibleEdges.map((edge) => (
                <tr key={edge.id}>
                  <td>{nodeLabels.get(edge.source) ?? "不明な項目"}</td>
                  <td>{graphEdgeTypeLabel(edge.type)}</td>
                  <td>{nodeLabels.get(edge.target) ?? "不明な項目"}</td>
                  <td>{Math.round(edge.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="muted">
        色はノードの種類を示します。善悪の価値序列ではありません。配置と接続探索はブラウザ内のGraphology／ForceAtlas2／Sigma.jsで行い、好みのスコアは変更しません。
      </p>
    </div>
  );
}
