import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { HypothesisPreview, PreferenceRefinement as RefinementInput } from "../../../shared/contracts/refinement";
import { type PreferenceQuestion, preferenceQuestions } from "../../../shared/preference-questions";
import { responseChannelLabel } from "../../../shared/response-channels";
import { Notice } from "../../components/Ui";
import { idempotencyKey } from "../../lib/http";
import { entriesApi } from "./api";

export function PreferenceRefinement({
  domain,
  entryId,
  questions,
  preview,
  analyzing,
  onUpdated,
}: {
  domain: AnalysisDomain;
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
      await entriesApi.refine(domain, entryId, input, idempotencyKey());
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
