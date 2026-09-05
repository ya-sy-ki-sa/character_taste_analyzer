import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";

export const understandingAspectLabels = {
  narrativeRole: "物語での役割",
  moralityOrientation: "善悪・道徳的な傾向",
  goals: "目的・目標",
  values: "重視する価値観",
  behavior: "行動・振る舞い",
  relationships: "他者との関係",
  expression: "表現・雰囲気",
} as const;

type Aspect = keyof typeof understandingAspectLabels;
const aspects = Object.keys(understandingAspectLabels) as Aspect[];
const hasContent = (values: string[]) => values.some((value) => value.trim().length > 0);

function uncertaintyFor(candidate: UnderstandingCandidate, aspect: Aspect) {
  return candidate.uncertainties.find(
    (item) =>
      (item.topic === aspect || item.topic === understandingAspectLabels[aspect]) && item.reason.trim().length > 0,
  );
}

export function understandingQualityIssues(candidate: UnderstandingCandidate): string[] {
  const issues = aspects
    .filter((aspect) => !hasContent(candidate.summary[aspect]) && !uncertaintyFor(candidate, aspect))
    .map((aspect) => `${aspect}: 内容、またはこのキーをtopicとする不明理由が必要です`);
  if (aspects.every((aspect) => !hasContent(candidate.summary[aspect])))
    issues.unshift("人物の同定だけで、7項目のキャラクター像がすべて空です");
  return issues;
}

/** Unknowns are display text only; never turn them into character assertions. */
export function explainUnknownUnderstandingAspects(candidate: UnderstandingCandidate): UnderstandingCandidate {
  const summary = { ...candidate.summary };
  for (const aspect of aspects) {
    const content = summary[aspect].map((item) => item.trim()).filter(Boolean);
    const uncertainty = uncertaintyFor(candidate, aspect);
    summary[aspect] = content.length
      ? content
      : uncertainty
        ? [
            `確認できません：${uncertainty.reason.trim()}`.slice(
              0,
              aspect === "narrativeRole" || aspect === "moralityOrientation" ? 200 : 500,
            ),
          ]
        : [];
  }
  return { ...candidate, summary };
}

export const UNDERSTANDING_COMPLETENESS_INSTRUCTION = `キャラクター像の7項目（${Object.entries(
  understandingAspectLabels,
)
  .map(([key, label]) => `${key}: ${label}`)
  .join("、")}）をそれぞれ検討してください。
各項目には根拠のある人物像を具体的な文章で記述し、対応するassertionsにも根拠と出所を残してください。名前・作品名だけでは人物像は完成していません。
公開資料にないという理由だけで、利用可能なモデル知識を一律に削除しないでください。モデル知識はexplicitnessとsourceRefをmodel_knowledgeとし、確信度を上げずに扱ってください。
本当に不明な項目はsummaryを空配列にし、uncertaintiesにtopicをその項目の英語キー、reasonを具体的な不明理由として記録してください。「不明」や「確認できません」などの代替文はsummaryに入れないでください。
全項目を埋めるために設定を創作したり、ユーザーの嗜好を人物の事実へ転用したりしないでください。`;
