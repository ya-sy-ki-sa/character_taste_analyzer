import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { darkResponseChannelCatalog } from "../../shared/dark-response-channels";
import { type PreferenceQuestion, preferenceQuestions } from "../../shared/preference-questions";
import type { HypothesisPreview, PreferenceRefinement as RefinementInput } from "../../shared/quality-schemas";
import { responseChannelCatalog, responseChannelLabel } from "../../shared/response-channels";
import type { AnyGeneratedCharacterCandidate } from "../../shared/schemas";
import { api, idempotencyKey } from "../api";
import { Notice } from "./Ui";

export type GenerationOption = {
  id: string;
  ordinal: number;
  character: AnyGeneratedCharacterCandidate;
  selected: boolean;
  comparison: { coherence: string; preferenceFit: string; difference: string; tradeoffs: string[] };
};
export function CandidateComparison({
  options,
  activeId,
  pending,
  onView,
  onSelect,
}: {
  options: GenerationOption[];
  activeId?: string;
  pending: boolean;
  onView(option: GenerationOption): void;
  onSelect(option: GenerationOption): void;
}) {
  return (
    <section className="quality-controls" aria-label="生成案の比較">
      <h3>合格した {options.length} 案を比較</h3>
      <p>必須・禁止条件と類似度の検査を通過した案です。設定を確認し、採用する案を選んでください。</p>
      {options.length < 3 && <p>3案のうち、検査を通過した案だけを表示しています。</p>}
      {options.map((option) => (
        <article className="quality-option" key={option.id}>
          <h4>
            案 {option.ordinal} · {option.character.identity.name}
            {option.selected ? " · 採用済み" : ""}
          </h4>
          <dl>
            <dt>条件への適合</dt>
            <dd>{option.comparison.preferenceFit}</dd>
            <dt>設定の一貫性</dt>
            <dd>{option.comparison.coherence}</dd>
            <dt>他案との違い</dt>
            <dd>{option.comparison.difference}</dd>
          </dl>
          {option.comparison.tradeoffs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <div className="button-row">
            <button
              className="button"
              type="button"
              onClick={() => onView(option)}
              aria-pressed={activeId === option.id}
            >
              この案の設定を見る
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={pending || option.selected}
              onClick={() => onSelect(option)}
            >
              {option.selected ? "採用済み" : "この案を採用"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

type FeedbackRow = {
  id: string;
  characterName: string;
  outputExcerpt: unknown;
  reason: string;
  status: string;
  preference: { label: string; polarity: string; responseChannel: string; scope: string };
};
type FeedbackResponse = { feedback: FeedbackRow[]; attributes: Array<{ stableKey: string; label: string }> };
const settingSections = [
  ["identity", "人物像"],
  ["appearance", "外見"],
  ["personality", "性格"],
  ["valuesAndMorality", "価値観"],
  ["motivations", "動機"],
  ["abilitiesAndLimits", "能力と限界"],
  ["relationships", "関係性"],
  ["speech", "話し方"],
  ["narrativeRole", "役割"],
  ["characterArc", "変化"],
  ["darkCore", "ダーク状態"],
  ["baselineAndTransition", "闇化の契機"],
  ["darkMorality", "道徳論理"],
  ["darkRelationships", "ダークな関係性"],
  ["darkArc", "ダークな結末"],
  ["darkExpression", "ダークな表現"],
] as const;
function feedbackSettings(character: AnyGeneratedCharacterCandidate) {
  const settings: Array<{ pointer: string; label: string }> = [];
  const visit = (value: unknown, pointer: string, label: string) => {
    if (typeof value === "string" && value.trim()) settings.push({ pointer, label: `${label}：${value.slice(0, 90)}` });
    else if (Array.isArray(value))
      value.forEach((item, index) => {
        visit(item, `${pointer}/${index}`, label);
      });
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`, label);
  };
  for (const [key, label] of settingSections)
    visit((character as unknown as Record<string, unknown>)[key], `/${key}`, label);
  return settings;
}
export function GenerationFeedback({ domain, option }: { domain: AnalysisDomain; option?: GenerationOption }) {
  const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["generation-feedback", domain],
    queryFn: () => api<FeedbackResponse>(`${base}/generation-feedback`),
  });
  const [reason, setReason] = useState(""),
    [scope, setScope] = useState(""),
    [pointer, setPointer] = useState(""),
    [attribute, setAttribute] = useState(""),
    [polarity, setPolarity] = useState("positive"),
    [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const catalog = domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog;
  const settings = option ? feedbackSettings(option.character) : [];
  async function submit() {
    if (!option) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`${base}/generation-feedback`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify({
          candidateId: option.id,
          outputPointer: pointer || settings[0]?.pointer,
          reason,
          scope,
          attributeStableKey: attribute,
          polarity,
          responseChannel: channel || catalog[0].value,
        }),
      });
      await client.invalidateQueries({ queryKey: ["generation-feedback", domain] });
      setReason("");
      setNotice("評価を候補として保存しました。確認後にプロフィールへ反映されます。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "評価を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  async function review(id: string, decision: "confirm" | "reject") {
    setBusy(true);
    setError(undefined);
    try {
      await api(`${base}/generation-feedback/${id}/review`, { method: "POST", body: JSON.stringify({ decision }) });
      await client.invalidateQueries({ queryKey: ["generation-feedback", domain] });
      await client.invalidateQueries({ queryKey: ["profile", domain] });
      setNotice(
        decision === "confirm"
          ? "確認した評価をプロフィールへ反映しています。"
          : "この評価はプロフィールへ反映しません。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "確認を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="quality-controls" aria-label={option ? "設定への評価" : "評価からの好み候補"}>
      <h3>{option ? "設定ごとに好みを記録" : "評価からの好み候補"}</h3>
      {error && <Notice tone="danger">{error}</Notice>}
      {query.isError && <Notice tone="danger">評価を読み込めませんでした。</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {option ? (
        <div className="form-grid">
          <label className="full">
            <span>評価する設定</span>
            <select value={pointer || settings[0]?.pointer || ""} onChange={(event) => setPointer(event.target.value)}>
              {settings.map((item) => (
                <option key={item.pointer} value={item.pointer}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>関連する属性</span>
            <select value={attribute} onChange={(event) => setAttribute(event.target.value)}>
              <option value="">属性を選択</option>
              {query.data?.attributes.map((item) => (
                <option key={item.stableKey} value={item.stableKey}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>評価</span>
            <select value={polarity} onChange={(event) => setPolarity(event.target.value)}>
              <option value="positive">好みに合う</option>
              <option value="negative">好みに合わない</option>
              <option value="mixed">好きと苦手が混在</option>
            </select>
          </label>
          <label className="full">
            <span>惹かれ方・反応</span>
            <select value={channel || catalog[0].value} onChange={(event) => setChannel(event.target.value)}>
              {catalog.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            <span>合う理由・合わない理由</span>
            <textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="full">
            <span>当てはまる条件（任意）</span>
            <input
              value={scope}
              maxLength={1000}
              onChange={(event) => setScope(event.target.value)}
              placeholder="例：敵対する場面に限る"
            />
          </label>
          <button
            className="button"
            type="button"
            disabled={busy || !attribute || !reason.trim()}
            onClick={() => void submit()}
          >
            好み候補として保存
          </button>
        </div>
      ) : (
        <>
          {!query.isPending && !query.data?.feedback.length && (
            <p>生成案の設定画面から、合う理由・合わない理由を記録できます。</p>
          )}
          {query.data?.feedback.map((item) => (
            <article className="quality-option" key={item.id}>
              <h4>
                {item.characterName} · {item.preference.label}
              </h4>
              <p>{item.reason}</p>
              <p>
                {item.preference.polarity === "positive"
                  ? "好みに合う"
                  : item.preference.polarity === "negative"
                    ? "好みに合わない"
                    : "好きと苦手が混在"}{" "}
                · {responseChannelLabel(item.preference.responseChannel)}
                {item.preference.scope ? ` · 条件：${item.preference.scope}` : ""}
              </p>
              {item.status === "proposed" ? (
                <div className="button-row">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void review(item.id, "confirm")}
                  >
                    確認してプロフィールへ反映
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => void review(item.id, "reject")}
                  >
                    反映しない
                  </button>
                </div>
              ) : (
                <small>{item.status === "confirmed" ? "確認済み" : "反映対象外"}</small>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
export function PreferenceRefinement({
  apiBase,
  entryId,
  questions,
  preview,
  analyzing,
  onUpdated,
}: {
  apiBase: string;
  entryId: string;
  questions: PreferenceQuestion[];
  preview: HypothesisPreview | null;
  analyzing: boolean;
  onUpdated(): Promise<unknown>;
}) {
  const prompts = preferenceQuestions(questions);
  const [answers, setAnswers] = useState<Record<number, string>>({}),
    [mode, setMode] = useState<"questions" | "hypotheses">(preview ? "hypotheses" : "questions"),
    [selection, setSelection] = useState<{ batchId: string; ids: string[] }>({ batchId: "", ids: [] }),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState<RefinementInput["mode"]>(),
    [error, setError] = useState<string>();
  const pending = busy || analyzing;
  const selectedIds = selection.batchId === preview?.id ? selection.ids : [];
  async function submit(input: RefinementInput) {
    setOperation(input.mode);
    setBusy(true);
    setError(undefined);
    try {
      await api(`${apiBase}/entries/${entryId}/preference-input`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify(input),
      });
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "追加分析を開始できませんでした");
    } finally {
      setBusy(false);
    }
  }
  function openHypotheses() {
    setMode("hypotheses");
    if (!preview && !pending) void submit({ mode: "hypotheses" });
  }
  return (
    <section className="quality-controls" aria-label="好みをもう少し確かめる">
      <h4>好みをもう少し確かめる</h4>
      <p>
        追加質問への回答や、選んだ仮説を加えて再分析できます。既存の「好き」は保持され、最後に確認するまで集計されません。
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <button
          className="button"
          type="button"
          aria-pressed={mode === "questions"}
          onClick={() => setMode("questions")}
        >
          追加質問に答える
        </button>
        <button
          className="button"
          type="button"
          disabled={pending}
          aria-pressed={mode === "hypotheses"}
          onClick={openHypotheses}
        >
          仮説候補から選ぶ
        </button>
      </div>
      {mode === "questions" ? (
        <>
          {prompts.map((question, index) => (
            <label className="quality-question" key={question}>
              <span>{question}</span>
              <textarea
                maxLength={2000}
                disabled={pending}
                value={answers[index] ?? ""}
                onChange={(event) => setAnswers({ ...answers, [index]: event.target.value })}
              />
            </label>
          ))}
          <button
            className="button button-primary"
            type="button"
            disabled={pending || !Object.values(answers).some((answer) => answer.trim())}
            onClick={() =>
              void submit({
                mode: "questions",
                answers: prompts.flatMap((question, index) =>
                  answers[index]?.trim() ? [{ question, answer: answers[index].trim() }] : [],
                ),
              })
            }
          >
            {pending ? "再分析を準備中…" : "回答から再分析"}
          </button>
        </>
      ) : (
        <fieldset className="hypothesis-candidates" aria-label="仮説候補">
          <legend>仮説候補</legend>
          <p>自分の好みに合うものにチェックしてください。「決定」を押すと、選んだ候補を加えて再分析します。</p>
          {pending && (
            <p role="status">
              {operation === "selection" ? "選んだ好みを加えて再分析しています…" : "仮説候補を作成しています…"}
            </p>
          )}
          {preview?.candidates?.length === 0 && (
            <p>今回は追加の候補を作れませんでした。候補を再作成するか、追加質問に答えてください。</p>
          )}
          {preview?.candidates?.map((candidate) => (
            <label className="hypothesis-option" key={candidate.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(candidate.id)}
                disabled={pending}
                onChange={(event) =>
                  setSelection({
                    batchId: preview.id,
                    ids: event.target.checked
                      ? [...selectedIds, candidate.id]
                      : selectedIds.filter((id) => id !== candidate.id),
                  })
                }
              />
              <span className="hypothesis-content">
                <strong>{candidate.description}</strong>
                <span className="hypothesis-detail">
                  {candidate.rawLabel} ／ {responseChannelLabel(candidate.responseChannel)} ／{" "}
                  {candidate.polarity === "positive"
                    ? "好き"
                    : candidate.polarity === "negative"
                      ? "苦手"
                      : "好き嫌いが混在"}
                </span>
                {candidate.scope && <span className="hypothesis-detail">条件：{candidate.scope}</span>}
                <span className="hypothesis-detail">{candidate.reason}</span>
              </span>
            </label>
          ))}
          <div className="button-row">
            <button
              className="button button-primary"
              type="button"
              disabled={pending || !preview?.candidates || !selectedIds.length}
              onClick={() =>
                preview &&
                void submit({ mode: "selection", hypothesisBatchId: preview.id, selectedHypothesisIds: selectedIds })
              }
            >
              決定
            </button>
            <button
              className="button"
              type="button"
              disabled={pending}
              onClick={() => void submit({ mode: "hypotheses" })}
            >
              仮説候補を再作成する
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
