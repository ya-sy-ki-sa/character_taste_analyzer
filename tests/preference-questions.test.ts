import { expect, it } from "vitest";
import { preferenceQuestions } from "../shared/preference-questions";
import { preferenceRefinementSchema } from "../shared/quality-schemas";

it("uses the actual recommended question rather than its uncertainty explanation", () => {
  expect(
    preferenceQuestions([
      {
        topic: "力への反応",
        reason: "どれが中心か不明である。",
        recommendedQuestion: "強さへの感嘆と、物語を盛り上げる面白さのどちらに惹かれますか？",
      },
    ]),
  ).toEqual(["強さへの感嘆と、物語を盛り上げる面白さのどちらに惹かれますか？"]);
});
it("turns legacy statements into answerable questions, with a safe length and default questions", () => {
  const result = preferenceQuestions([
    { topic: "悪や残酷さへの好意", reason: "支持されていない。", recommendedQuestion: "判断できない。" },
  ]);
  expect(result[0]).toContain("どのように感じますか？");
  expect(result[0]).not.toContain("判断できない");
  expect(preferenceQuestions([]).every((question) => question.includes("？"))).toBe(true);
  expect(preferenceQuestions([{ topic: "a".repeat(500), reason: "b" }])[0].length).toBeLessThanOrEqual(500);
});
it("requires a nonempty, unique selection of saved hypothesis IDs", () => {
  const id = crypto.randomUUID(),
    input = { mode: "selection", hypothesisBatchId: crypto.randomUUID(), selectedHypothesisIds: [id] };
  expect(preferenceRefinementSchema.safeParse(input).success).toBe(true);
  expect(preferenceRefinementSchema.safeParse({ ...input, selectedHypothesisIds: [] }).success).toBe(false);
  expect(preferenceRefinementSchema.safeParse({ ...input, selectedHypothesisIds: [id, id] }).success).toBe(false);
});
