import { z } from "zod";
import { type JudgmentAnswer, JudgmentProviderError, type JudgmentQuestion, type JudgmentResult } from "./types";

const probability = z.number().finite().min(0).max(1);
const distribution = z.record(z.string(), probability);
const wireAnswer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities: distribution, confidence: probability }),
  z.object({
    type: z.literal("score"),
    score: z.number().finite(),
    probabilities: distribution,
    legend: z.record(z.string(), z.string()),
    confidence: probability,
  }),
]);
const wireResult = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), wireAnswer),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions: z.string().min(1),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1),
    criteria: z
      .record(z.string(), z.string())
      .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 255),
  }),
  z.object({ type: z.literal("score"), instructions: z.string().min(1), criteria: z.array(z.string()).min(2).max(10) }),
]);

function sameKeys(left: object, right: object) {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key))
  );
}
export function validateQuestions(questions: Record<string, JudgmentQuestion>) {
  if (!z.record(z.string().min(1), questionSchema).safeParse(questions).success)
    throw new JudgmentProviderError("invalid_questions", false);
}

export function parseJudgmentResult(raw: unknown, questions: Record<string, JudgmentQuestion>): JudgmentResult {
  const parsed = wireResult.safeParse(raw);
  if (!parsed.success || !sameKeys(parsed.data.answers, questions))
    throw new JudgmentProviderError("invalid_response", false);
  const result: JudgmentResult = { ...parsed.data, answers: {} };
  for (const [id, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[id];
    if (answer.type !== question.type) throw new JudgmentProviderError("answer_type_mismatch", false);
    if (answer.type === "noul") {
      result.answers[id] = answer;
      continue;
    }
    const expected =
      question.type === "choice"
        ? question.criteria
        : question.type === "score"
          ? Object.fromEntries(question.criteria.map((level, index) => [String(index), level]))
          : {};
    const probabilities = Object.values(answer.probabilities);
    if (!sameKeys(answer.probabilities, expected) || Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > 0.001)
      throw new JudgmentProviderError("invalid_distribution", false);
    if (answer.type === "choice") {
      if (!Object.hasOwn(expected, answer.choice) || answer.probabilities[answer.choice] < Math.max(...probabilities))
        throw new JudgmentProviderError("invalid_choice", false);
      result.answers[id] = answer;
    } else {
      const ordered = Object.keys(expected).map((key) => answer.probabilities[key]);
      const expectation = ordered.reduce((sum, value, index) => sum + value * index, 0);
      if (
        !sameKeys(answer.legend, expected) ||
        Object.keys(expected).some((key) => answer.legend[key] !== expected[key]) ||
        answer.score < 0 ||
        answer.score > ordered.length - 1 ||
        Math.abs(expectation - answer.score) > 0.01
      )
        throw new JudgmentProviderError("invalid_score", false);
      result.answers[id] = {
        type: "score",
        score: answer.score,
        confidence: answer.confidence,
        probabilities: ordered,
      };
    }
  }
  return result;
}

export function fixtureResult(
  model: string,
  answers: Record<string, JudgmentAnswer>,
  questions: Record<string, JudgmentQuestion>,
) {
  const wire = Object.fromEntries(
    Object.entries(answers).map(([id, answer]) => {
      const question = questions[id];
      return [
        id,
        answer.type === "score" && question?.type === "score"
          ? {
              ...answer,
              probabilities: Object.fromEntries(answer.probabilities.map((p, i) => [String(i), p])),
              legend: Object.fromEntries(question.criteria.map((level, i) => [String(i), level])),
            }
          : answer,
      ];
    }),
  );
  return parseJudgmentResult({ model, answers: wire, usage: { input_tokens: 0, output_tokens: 0 } }, questions);
}
