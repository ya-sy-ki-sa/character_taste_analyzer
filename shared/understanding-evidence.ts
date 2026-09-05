import type { UnderstandingEvidenceSummary } from "./contracts/understanding-evidence";

export const understandingEvidenceLabels = {
  sourceQuote: "資料の原文照合済み",
  userInputQuote: "ユーザー入力の原文照合済み",
  userConfirmation: "ユーザー確認文",
  sourceAttributed: "出典のみ確認",
  modelKnowledge: "モデル知識",
  invalid: "検証できない根拠",
  unclassified: "未分類",
} as const;

export const understandingEvidenceExplanation =
  "件数は根拠の記録数で、資料数や正確性の割合ではありません。原文照合やユーザー確認は、内容の正しさや属性への裏付けを保証しません。";

type Evidence = { id: string; verificationStatus: string; evidenceOrigin?: string };
type Assertion = { status: string; evidence: readonly Evidence[] };

function category(evidence: Evidence): keyof UnderstandingEvidenceSummary["counts"] {
  switch (evidence.verificationStatus) {
    case "invalid":
      return "invalid";
    case "model_knowledge":
      return "modelKnowledge";
    case "source_attributed":
      return "sourceAttributed";
    case "verified_quote":
      switch (evidence.evidenceOrigin) {
        case "source":
          return "sourceQuote";
        case "user_input":
          return "userInputQuote";
        case "review":
          return "userConfirmation";
      }
  }
  return "unclassified";
}

/** Read-time counts of current assertions; never a confidence or profile weight. */
export function summarizeUnderstandingEvidence(assertions: readonly Assertion[]): UnderstandingEvidenceSummary {
  const active = assertions.filter((item) => !["rejected", "superseded"].includes(item.status));
  const counts: UnderstandingEvidenceSummary["counts"] = {
    sourceQuote: 0,
    userInputQuote: 0,
    userConfirmation: 0,
    sourceAttributed: 0,
    modelKnowledge: 0,
    invalid: 0,
    unclassified: 0,
  };
  const seen = new Set<string>();
  for (const assertion of active) {
    for (const evidence of assertion.evidence) {
      if (seen.has(evidence.id)) continue;
      seen.add(evidence.id);
      counts[category(evidence)]++;
    }
  }
  return {
    assertionCount: active.length,
    assertionsWithoutEvidence: active.filter((item) => item.evidence.length === 0).length,
    counts,
  };
}
