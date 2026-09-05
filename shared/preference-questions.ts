export type PreferenceQuestion = { topic: string; reason: string; recommendedQuestion?: string | null };

/** Existing reports may only contain an uncertainty statement. Always display an actual question. */
export function preferenceQuestions(uncertainties: PreferenceQuestion[]): string[] {
  if (!uncertainties.length)
    return ["どの行動や設定に、どのような気持ちを持ちましたか？", "好き・苦手が変わる場面や条件はありますか？"];
  return uncertainties.slice(0, 3).map((item) => {
    const question = item.recommendedQuestion?.trim();
    if (question && question.length <= 500 && /[？?]/u.test(question)) return question;
    return `「${item.topic.slice(0, 350)}」について、どのように感じますか？好きな点・苦手な点や、そう感じる場面を教えてください。`;
  });
}
