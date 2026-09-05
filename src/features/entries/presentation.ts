export const understandingSummaryLabels: Record<string, string> = {
  narrativeRole: "物語での役割",
  moralityOrientation: "善悪・道徳的な傾向",
  goals: "目的・目標",
  values: "重視する価値観",
  behavior: "行動・振る舞い",
  relationships: "他者との関係",
  expression: "表現・雰囲気",
  darkState: "主体性・支配構造",
  auditNotes: "整合性監査メモ",
};

export const darkStateLabels: Record<string, string> = {
  agencyOrigin: "主体性の由来",
  consent: "同意",
  awareness: "認識",
  resistance: "抵抗",
  identityContinuity: "自我連続性",
  responsibility: "責任帰属",
  reversibility: "可逆性",
  controllerOrInfluence: "支配者・影響源",
  mechanism: "機構",
  before: "変化前",
  onset: "発生",
  activeState: "闇状態",
  recoveryOrAfter: "回復後・その後",
};

export function understandingSummaryLabel(key: string): string {
  return understandingSummaryLabels[key] ?? "その他の特徴";
}

export function reviewSummaryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("、") || "—";
  if (value && typeof value === "object")
    return (
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== "")
        .map(([key, item]) => `${darkStateLabels[key] ?? key}: ${String(item)}`)
        .join(" ／ ") || "—"
    );
  return String(value ?? "—");
}

export const statusLabels: Record<string, string> = {
  submitted: "理解を解析中",
  understanding: "理解を解析中",
  understanding_review: "基本像の確認待ち",
  analyzing: "好みを解析中",
  analysis_review: "好みの候補の確認待ち",
  active: "解析済み",
  failed: "解析エラー",
  archived: "除外済み",
};

export const analysisErrorLabels: Record<string, string> = {
  LLM_SCHEMA_INVALID: "LLMの応答形式が解析仕様を満たしませんでした",
  EXTERNAL_PROVIDER_REJECTED: "LLMサービスが解析リクエストを受け付けませんでした",
  EXTERNAL_PROVIDER_REFUSED: "LLMサービスが回答を拒否しました",
  EXTERNAL_PROVIDER_INCOMPLETE: "LLMサービスの回答が未完了でした",
  EXTERNAL_PROVIDER_UNAVAILABLE: "LLMサービスへ接続できませんでした",
  PROVIDER_CAPACITY_EXHAUSTED: "LLMサービスの利用上限または処理容量に達しました",
  EXTERNAL_PROVIDER_INVALID_RESPONSE: "LLMサービスから有効な応答を取得できませんでした",
  EXTERNAL_CITATION_NOT_ALLOWED: "LLMの回答に確認できない外部出典が含まれていました",
  EVIDENCE_SOURCE_INVALID: "LLMの回答に確認できない根拠が含まれていました",
  PREFERENCE_ANALYSIS_EMPTY: "好みの候補を生成できませんでした",
};

export const reanalyzableStatuses = new Set(["understanding_review", "analysis_review", "active", "failed"]);
