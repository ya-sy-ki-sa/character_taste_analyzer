import { describe, expect, it } from "vitest";
// @ts-expect-error JS evaluation module
import { extractClaims, gradingInstructions } from "../evaluation/live-personas/grading.mjs";

describe("live persona grading boundaries", () => {
  it("separates summary text from structured preference claims", () => {
    const claims = extractClaims({
      preferenceAnalysis: {
        summary: { userExplicitSummary: ["好き。"], inferredSummary: [] },
        assertions: [
          {
            id: "assertion",
            raw_label: "勇気",
            polarity: "positive",
            response_channel: null,
            explicitness: "user_explicit",
            evidence: [],
            stable_key: null,
          },
        ],
        valueStances: [
          {
            id: "stance",
            target_ref: "救助",
            stance: "support",
            orientation: "positive",
            explicitness: "user_explicit",
            evidence: [],
          },
        ],
      },
    });

    expect(claims.map((claim: { stage: string }) => claim.stage)).toEqual([
      "preference_summary",
      "preference_assertion",
      "value_stance",
    ]);
    expect(gradingInstructions).toContain("preference_summaryへの再掲だけではmatchedまたはpartialにせず");
  });
});
