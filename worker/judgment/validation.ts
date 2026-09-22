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
function normalizeDistribution(probabilities: Record<string, number>): Record<string, number> {
  const values = Object.values(probabilities);
  const total = values.reduce((sum, value) => sum + value, 0);
  // Jev returns probabilities rounded to two decimal places. Allow only the
  // resulting rounding error, then restore a normalized distribution locally.
  const roundingTolerance = 0.005 * values.length + 0.001;
  if (total <= 0 || Math.abs(total - 1) > roundingTolerance)
    throw new JudgmentProviderError("invalid_distribution", false);
  return Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, value / total]));
}
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
    if (!sameKeys(answer.probabilities, expected)) throw new JudgmentProviderError("invalid_distribution", false);
    const probabilities = normalizeDistribution(answer.probabilities);
    if (answer.type === "choice") {
      if (!Object.hasOwn(expected, answer.choice)) throw new JudgmentProviderError("invalid_choice", false);
      result.answers[id] = { ...answer, probabilities };
    } else {
      const ordered = Object.keys(expected).map((key) => probabilities[key]);
      if (
        !sameKeys(answer.legend, expected) ||
        Object.keys(expected).some((key) => answer.legend[key] !== expected[key]) ||
        answer.score < 0 ||
        answer.score > ordered.length - 1
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
