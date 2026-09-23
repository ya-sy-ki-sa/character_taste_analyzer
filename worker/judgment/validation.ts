import { z } from "zod";
import { type ChoiceAnswer, JudgmentProviderError, type JudgmentQuestion, type JudgmentResult } from "./types";

const probability = z.number().finite().min(0).max(1);
const wireAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), probability),
  confidence: probability,
});
const wireResult = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), wireAnswer),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

export function validateQuestions(questions: Record<string, JudgmentQuestion>): void {
  if (
    !z
      .record(
        z.string().min(1),
        z.object({
          type: z.literal("choice"),
          instructions: z.string().min(1),
          criteria: z.record(z.string(), z.string().min(1)).refine((items) => {
            const count = Object.keys(items).length;
            return count >= 2 && count <= 255;
          }),
        }),
      )
      .safeParse(questions).success
  )
    throw new JudgmentProviderError("invalid_questions", false);
}

function sameKeys(left: object, right: object): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key))
  );
}

/** Reject missing/extra answers and rounded probability distributions outside the documented tolerance. */
export function parseJudgmentResult(raw: unknown, questions: Record<string, JudgmentQuestion>): JudgmentResult {
  const parsed = wireResult.safeParse(raw);
  if (!parsed.success || !sameKeys(parsed.data.answers, questions))
    throw new JudgmentProviderError("invalid_response", false);
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[id];
    if (!sameKeys(answer.probabilities, question.criteria) || !Object.hasOwn(question.criteria, answer.choice))
      throw new JudgmentProviderError("invalid_distribution", false);
    const sum = Object.values(answer.probabilities).reduce((total, value) => total + value, 0);
    if (sum <= 0 || Math.abs(sum - 1) > 0.005 * Object.keys(question.criteria).length + 0.001)
      throw new JudgmentProviderError("invalid_distribution", false);
    answers[id] = {
      ...answer,
      probabilities: Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [key, value / sum])),
    };
  }
  return { model: parsed.data.model, usage: parsed.data.usage, answers };
}

export function fixtureResult(
  model: string,
  answers: Record<string, ChoiceAnswer>,
  questions: Record<string, JudgmentQuestion>,
): JudgmentResult {
  return parseJudgmentResult({ model, answers, usage: { input_tokens: 0, output_tokens: 0 } }, questions);
}
