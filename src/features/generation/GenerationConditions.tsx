import type { GenerationRequestInput } from "../../../shared/contracts/generation";
import { snapshotItemLabel, snapshotItemTypeLabel } from "../../../shared/presentation-labels";
import { responseChannelLabel } from "../../../shared/response-channels";
import { Card } from "../../components/Ui";
import { type SnapshotTreatment, snapshotConditionLabel } from "../../lib/generation-snapshot-items";
import type { useGeneration } from "./use-generation";

export const modes: Array<{ id: GenerationRequestInput["mode"]; symbol: string; title: string; description: string }> =
  [
    { id: "faithful", symbol: "◎", title: "忠実", description: "選択項目を必須条件として強く反映します。" },
    { id: "balanced", symbol: "◐", title: "バランス", description: "選択した核を保ち、少数の新しい要素を加えます。" },
    { id: "exploratory", symbol: "✦", title: "探索", description: "禁止条件を守りつつ、意外な組合せを探します。" },
  ];

export function snapshotScopeLabel(conditions: Record<string, unknown>[]): string {
  const labels = [...new Set(conditions.map(snapshotConditionLabel).filter(Boolean))];
  return labels.length ? `・${labels.join(" ／ ")}` : "";
}

export function GenerationConditions({
  mode,
  setMode,
  purpose,
  setPurpose,
  world,
  setWorld,
  genre,
  setGenre,
  role,
  setRole,
  tone,
  setTone,
  instruction,
  setInstruction,
  treatments,
  setTreatments,
  overrides,
  setOverrides,
  submitting,
  snapshot,
  groupedSnapshotItems,
  submit,
  selectedCount,
}: Pick<
  ReturnType<typeof useGeneration>,
  | "mode"
  | "setMode"
  | "purpose"
  | "setPurpose"
  | "world"
  | "setWorld"
  | "genre"
  | "setGenre"
  | "role"
  | "setRole"
  | "tone"
  | "setTone"
  | "instruction"
  | "setInstruction"
  | "treatments"
  | "setTreatments"
  | "overrides"
  | "setOverrides"
  | "submitting"
  | "snapshot"
  | "groupedSnapshotItems"
  | "submit"
  | "selectedCount"
>) {
  if (!snapshot.data?.snapshot) return null;
  return (
    <form onSubmit={submit} className="generation-config">
      <div className="section-title">
        <div>
          <p className="eyebrow">PROFILE SNAPSHOT</p>
          <h2>使う好みを選ぶ</h2>
        </div>
        <small>プロフィール世代 {snapshot.data.snapshot.generation} に固定</small>
      </div>
      <Card className="selection-table">
        <div className="selection-head">
          <span>好みの項目</span>
          <span>扱い</span>
        </div>
        {groupedSnapshotItems.map((item) => (
          <div className="selection-row" key={item.id}>
            <span>
              <strong>{snapshotItemLabel(item)}</strong>
              <small>
                {snapshotItemTypeLabel(item.type)}
                {item.responseChannels.length
                  ? `・${item.responseChannels.map((channel) => responseChannelLabel(channel)).join("／")}`
                  : ""}
                {snapshotScopeLabel(item.conditions)}
              </small>
              {item.itemIds.length > 1 && (
                <details className="condition-details">
                  <summary>条件・惹かれ方ごとに調整</summary>
                  {item.itemIds.map((id) => {
                    const individual = snapshot.data?.items.find((candidate) => candidate.id === id);
                    if (!individual) return null;
                    const condition = individual.payload.condition ?? individual.payload.scope;
                    const scope = snapshotConditionLabel(condition);
                    return (
                      <label className="quality-question" key={id}>
                        <span>
                          {responseChannelLabel(String(individual.payload.responseChannel ?? ""))}
                          {scope ? ` · ${scope}` : ""}
                        </span>
                        <select
                          aria-label={`${individual.label}の条件別の扱い`}
                          value={overrides[id] ?? treatments[item.id] ?? "omit"}
                          onChange={(event) =>
                            setOverrides({ ...overrides, [id]: event.target.value as SnapshotTreatment })
                          }
                        >
                          <option value="include">使う</option>
                          <option value="prohibit">入れない</option>
                          <option value="omit">今回は使わない</option>
                        </select>
                      </label>
                    );
                  })}
                </details>
              )}
            </span>
            <select
              value={treatments[item.id] ?? "omit"}
              onChange={(event) => {
                setTreatments((current) => ({ ...current, [item.id]: event.target.value as SnapshotTreatment }));
                setOverrides((current) =>
                  Object.fromEntries(Object.entries(current).filter(([id]) => !item.itemIds.includes(id))),
                );
              }}
            >
              <option value="include">使う</option>
              <option value="prohibit">入れない</option>
              <option value="omit">今回は使わない</option>
            </select>
          </div>
        ))}
      </Card>
      <div className="section-title">
        <div>
          <p className="eyebrow">GENERATION MODE</p>
          <h2>生成モード</h2>
        </div>
      </div>
      <div className="mode-grid">
        {modes.map((item) => (
          <button
            type="button"
            className={`mode-card ${mode === item.id ? "active" : ""}`}
            onClick={() => setMode(item.id)}
            key={item.id}
          >
            <span className="mode-symbol">{item.symbol}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>
      <Card className="generation-form-card">
        <div className="form-grid">
          <label className="full">
            <span>
              作成目的 <b>必須</b>
            </span>
            <textarea
              required
              maxLength={2000}
              rows={2}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </label>
          <label className="full">
            <span>世界観</span>
            <textarea maxLength={4000} rows={3} value={world} onChange={(event) => setWorld(event.target.value)} />
          </label>
          <label>
            <span>ジャンル</span>
            <input maxLength={200} value={genre} onChange={(event) => setGenre(event.target.value)} />
          </label>
          <label>
            <span>物語上の役割</span>
            <input
              maxLength={2000}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="物語の中での役割を入力してください"
            />
          </label>
          <label>
            <span>表現トーン</span>
            <input maxLength={1000} value={tone} onChange={(event) => setTone(event.target.value)} />
          </label>
          <label className="full">
            <span>自由指示</span>
            <textarea
              maxLength={4000}
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          className="button button-primary button-generate"
          disabled={submitting || selectedCount === 0}
        >
          {submitting ? "生成条件を保存中…" : `✦ 選択した${selectedCount}項目から作成`}
        </button>
      </Card>
    </form>
  );
}
