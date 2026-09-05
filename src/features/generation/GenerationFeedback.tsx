import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GenerationFeedbackInput } from "../../../shared/contracts/generation-feedback";
import type { GenerationOption } from "../../../shared/contracts/generation-response";
import { darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import { responseChannelCatalog, responseChannelLabel } from "../../../shared/response-channels";
import { Notice } from "../../components/Ui";
import { idempotencyKey } from "../../lib/http";
import { generationApi } from "./api";
import { feedbackSettings } from "./feedback-settings";

export function GenerationFeedback({ domain, option }: { domain: AnalysisDomain; option?: GenerationOption }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["generation-feedback", domain],
    queryFn: () => generationApi.feedback(domain),
  });
  const [reason, setReason] = useState(""),
    [scope, setScope] = useState(""),
    [pointer, setPointer] = useState(""),
    [attribute, setAttribute] = useState(""),
    [polarity, setPolarity] = useState<GenerationFeedbackInput["polarity"]>("positive"),
    [channel, setChannel] = useState<GenerationFeedbackInput["responseChannel"] | "">("");
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
      await generationApi.createFeedback(
        domain,
        {
          candidateId: option.id,
          outputPointer: pointer || settings[0]?.pointer || "",
          reason,
          scope,
          attributeStableKey: attribute,
          polarity,
          responseChannel: channel || catalog[0].value,
        },
        idempotencyKey(),
      );
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
      await generationApi.reviewFeedback(domain, id, { decision });
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
            <select
              value={polarity}
              onChange={(event) => setPolarity(event.target.value as GenerationFeedbackInput["polarity"])}
            >
              <option value="positive">好みに合う</option>
              <option value="negative">好みに合わない</option>
              <option value="mixed">好きと苦手が混在</option>
            </select>
          </label>
          <label className="full">
            <span>惹かれ方・反応</span>
            <select
              value={channel || catalog[0].value}
              onChange={(event) => setChannel(event.target.value as GenerationFeedbackInput["responseChannel"])}
            >
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
