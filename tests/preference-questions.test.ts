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
it("uses general questions for an empty report and omits explicitly absent questions", () => {
  expect(preferenceQuestions([]).every((question) => question.includes("？"))).toBe(true);
  expect(
    preferenceQuestions([{ topic: "悪や残酷さへの好意", reason: "支持されていない。", recommendedQuestion: null }]),
  ).toEqual([]);
});

it("requires a nonempty, unique selection of saved hypothesis IDs", () => {
  const id = crypto.randomUUID(),
    input = { mode: "selection", hypothesisBatchId: crypto.randomUUID(), selectedHypothesisIds: [id] };
  expect(preferenceRefinementSchema.safeParse(input).success).toBe(true);
  expect(preferenceRefinementSchema.safeParse({ ...input, selectedHypothesisIds: [] }).success).toBe(false);
  expect(preferenceRefinementSchema.safeParse({ ...input, selectedHypothesisIds: [id, id] }).success).toBe(false);
});
