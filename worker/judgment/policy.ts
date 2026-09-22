import type { ChoiceAnswer, JudgmentAnswer, JudgmentQuestion, ScoreAnswer } from "./types";

/** Provisional policy, not a claim of calibrated Japanese-domain accuracy. */
export const JUDGMENT_POLICY_VERSION = "jev-policy/1.0";
export const MAX_RECONSIDERATION_ROUNDS = 2;
export const CHOICE_PROBABILITY = 0.9;
export const CHOICE_CONFIDENCE = 0.8;
export const NOUL_YES = 0.9;
export const NOUL_NO = 0.1;

export function isCertainChoice(answer: JudgmentAnswer | undefined): answer is ChoiceAnswer {
  return (
    answer?.type === "choice" &&
    answer.confidence >= CHOICE_CONFIDENCE &&
    (answer.probabilities[answer.choice] ?? 0) >= CHOICE_PROBABILITY
  );
}
export function isCertainNoul(answer: JudgmentAnswer | undefined): boolean {
  return answer?.type === "noul" && (answer.noul >= NOUL_YES || answer.noul <= NOUL_NO);
}
export function isCertainScore(answer: JudgmentAnswer | undefined): answer is ScoreAnswer {
  return answer?.type === "score" && answer.confidence >= CHOICE_CONFIDENCE;
}

export function choiceAnswer(question: Extract<JudgmentQuestion, { type: "choice" }>, choice: string): ChoiceAnswer {
  return {
    type: "choice",
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])),
  };
}
export function scoreAnswer(question: Extract<JudgmentQuestion, { type: "score" }>, level: number): ScoreAnswer {
  return {
    type: "score",
    score: level,
    confidence: 1,
    probabilities: question.criteria.map((_, index) => (index === level ? 1 : 0)),
  };
}
