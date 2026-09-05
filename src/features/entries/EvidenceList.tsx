import type { EvidenceDetail } from "../../../shared/contracts/entry-review";
import { canonicalEntryInputPointer } from "../../../shared/entry-input";
import { evidenceQuoteLabel } from "../../lib/analysis-labels";

export const evidenceSourceProviderLabels: Record<string, string> = {
  wikipedia_ja: "日本語Wikipedia",
  wikidata: "Wikidata",
  openai_web_search: "OpenAI Web Search",
};

export const evidenceStatusLabels: Record<string, string> = {
  verified_quote: "原文照合済み",
  source_attributed: "出典のみ確認",
  model_knowledge: "モデル知識",
  invalid: "根拠を検証できません",
};

export const evidenceInferenceLabels: Record<string, string> = {
  direct: "直接引用",
  paraphrase: "要約・言い換え",
  inferred: "推論",
};

export const inputPointerLabels: Record<string, string> = {
  "/workTitle": "作品名",
  "/characterName": "キャラクター名",
  "/mediaType": "媒体種別",
  "/representationType": "改変種別",
  "/customizationDescription": "改変内容",
  "/characterBasicInfo": "キャラクター基本情報",
  "/preferenceContext": "対象範囲・場面",
  "/referenceMaterial": "追加の参考情報",
  "/userCharacterView": "ユーザーのキャラクター観",
  "/preference/likedReasons": "好きな理由",
  "/preference/dislikedReasons": "苦手な理由",
  "/preference/responseChannels": "選択した惹かれ方",
  "/preference/valueStanceNote": "価値スタンス",
};

export function EvidenceList({ evidence }: { evidence: EvidenceDetail[] }) {
  if (!evidence.length) return <small className="evidence-status">根拠なし</small>;
  return (
    <details className="evidence-disclosure">
      <summary>
        <span className="evidence-open-label">詳細を見る</span>
        <span className="evidence-close-label">詳細を閉じる</span>
      </summary>
      <ul className="evidence-list">
        {evidence.map((item) => {
          const pointer = canonicalEntryInputPointer(item.inputPointer);
          return (
            <li key={item.id} className={`evidence-item evidence-${item.verificationStatus}`}>
              <div className="evidence-heading">
                <span className="evidence-status">
                  {evidenceStatusLabels[item.verificationStatus] ?? "検証状態未分類"}
                </span>
                <small>{evidenceInferenceLabels[item.inferenceType] ?? "根拠形式未分類"}</small>
              </div>
              {item.quote && (
                <div className="evidence-detail">
                  <span>引用</span>
                  <q>{evidenceQuoteLabel(item.quote, pointer)}</q>
                </div>
              )}
              {pointer && (
                <div className="evidence-detail">
                  <span>入力項目</span>
                  <strong>{inputPointerLabels[pointer] ?? "登録情報"}</strong>
                </div>
              )}
              {item.verificationStatus === "invalid" && (
                <small className="evidence-warning">
                  指定された入力または出典と照合できなかったため、この根拠は採用されません。
                </small>
              )}
              {(item.sourceProvider || item.trustReason) && (
                <small>
                  取得元:{" "}
                  {item.sourceProvider ? (evidenceSourceProviderLabels[item.sourceProvider] ?? "公開情報") : "公開情報"}
                  {item.trustReason ? `／採用理由: ${item.trustReason}` : ""}
                </small>
              )}
              {item.canNavigate && item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  原文へ移動
                </a>
              ) : item.sourceTitle ? (
                <small>出典: {item.sourceTitle}</small>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
