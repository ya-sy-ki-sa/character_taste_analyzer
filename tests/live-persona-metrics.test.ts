import { describe, expect, it } from "vitest";
// @ts-expect-error JS evaluation module
import * as metrics from "../evaluation/live-personas/metrics.mjs";

const { judgmentQuestionMetrics, preferencePrecisionMetrics, understandingInformationMetrics } = metrics;

describe("live evaluation metrics", () => {
  it("separates canonical assertions, aspect coverage and provenance counts", () => {
    const snapshot = {
      assertions: [
        {
          stable_key: "role.hero",
          value_text: "仲間を助ける",
          explicitness: "user_explicit",
          evidence: [{ evidenceOrigin: "user_input", verificationStatus: "verified_quote" }],
        },
        {
          stable_key: "role.hero",
          value_text: "仲間を助ける",
          explicitness: "user_explicit",
          evidence: [{ evidenceOrigin: "user_input", verificationStatus: "verified_quote" }],
        },
        {
          stable_key: null,
          value_text: "未照合の場面",
          explicitness: "model_knowledge",
          evidence: [{ evidenceOrigin: "model_knowledge", verificationStatus: "model_knowledge" }],
        },
      ],
      informationQuality: {
        status: "limited",
        concreteAspectCount: 2,
        groundedConcreteItemCount: 1,
        modelKnowledgeConcreteItemCount: 1,
        aspects: {
          behavior: { kind: "concrete", assertionIndexes: [0, 1] },
          expression: { kind: "concrete", assertionIndexes: [2] },
        },
      },
    };
    expect(understandingInformationMetrics([snapshot])).toMatchObject({
      assertionCount: 3,
      canonicalAssertionCount: 2,
      concreteAspectCount: 2,
      groundedConcreteItemCount: 1,
      modelKnowledgeConcreteItemCount: 1,
      modelKnowledgeAssertionCount: 1,
      aspectCoverage: 2,
      groundedCoverage: 1,
      limitedCount: 1,
    });
  });

  it("counts Jev questions while leaving unavailable causal contribution unmeasured", () => {
    const rows = judgmentQuestionMetrics([
      {
        calls: [
          {
            stage: "target:assertion",
            answers: [
              { id: "assertion_1_attribute", type: "choice", confidence: 0.9 },
              { id: "assertion_2_attribute", type: "choice", confidence: 0.4 },
            ],
          },
        ],
      },
    ]);
    expect(rows).toEqual([
      {
        stage: "target:assertion",
        type: "choice",
        questionFamily: "attribute",
        answers: 2,
        lowConfidence: 1,
        lowConfidenceRate: 0.5,
        finalOutcomeContribution: null,
      },
    ]);
  });
  it("reports target and response precision on independent reviewed denominators", () => {
    expect(
      preferencePrecisionMetrics({
        cases: {
          A13: {
            claims: {
              Q027: { target: "correct", responseChannel: "incorrect" },
              Q029: { target: "incorrect", responseChannel: "not_evaluable" },
            },
          },
        },
      }),
    ).toEqual({
      target: { correct: 1, assessed: 2, precision: 0.5 },
      responseChannel: { correct: 0, assessed: 1, precision: 0 },
    });
  });
});
