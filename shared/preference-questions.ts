import type { PreferenceCandidate } from "./contracts/preference";

export type PreferenceQuestion = PreferenceCandidate["uncertainties"][number];

export function preferenceQuestions(uncertainties: PreferenceQuestion[]): string[] {
  if (!uncertainties.length)
    return ["どの行動や設定に、どのような気持ちを持ちましたか？", "好き・苦手が変わる場面や条件はありますか？"];
  return uncertainties.flatMap((item) => (item.recommendedQuestion ? [item.recommendedQuestion] : [])).slice(0, 3);
}
