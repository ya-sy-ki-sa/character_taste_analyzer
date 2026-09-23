import { describe, expect, it } from "vitest";
import { preferenceCandidateSchema } from "../shared/contracts/preference";
import { isExplicitHeroPraise, retainExplicitAdmiration } from "../worker/features/analysis/preference-admiration";

const sentence = "自分が不利になっても相手を安心させようとするのが本当のヒーローだと思う。";
const input = `明るく笑っているだけの先輩じゃなく、困っている子を置いていかないところが好き。${sentence}強さの順位を比べたいわけではない。自分も誰かが困っていたら声をかけられるようになりたいし、こういう先輩を応援したくなる。`;
const candidate = () =>
  preferenceCandidateSchema.parse({
    summary: { userExplicitSummary: [], inferredSummary: [], limitations: [] },
    preferenceAssertions: [
      {
        attributeStableKey: null,
        rawLabel: "困っている子を置いていかない姿勢",
        polarity: "positive",
        responseChannel: "root_for",
        strength: 0.6,
        explicitness: "user_explicit",
        confidence: 0.9,
        context: {
          schemaVersion: "2",
          entryScope: null,
          subjects: ["通形ミリオ"],
          relationships: [],
          narrativePhases: [],
          conditions: ["こういう先輩として"],
          exceptions: [],
        },
        evidence: [
          {
            sourceRef: "input:/preference/likedReasons",
            inputPointer: "/preference/likedReasons",
            sourceUrl: null,
            quote: "自分が不利になっても相手を安心させようとする",
            inferenceType: "direct",
          },
        ],
      },
    ],
    valueStanceAssertions: [],
    uncertainties: [],
  });

describe("independently grounded high evaluation", () => {
  it("retains A15 admiration separate from root_for with an exact quote", () => {
    const value = candidate();
    retainExplicitAdmiration(value, input);
    expect(value.preferenceAssertions).toHaveLength(2);
    expect(value.preferenceAssertions[1]).toMatchObject({
      rawLabel: "自分が不利になっても相手を安心させようとする",
      responseChannel: "admiration",
      explicitness: "user_explicit",
      context: { conditions: [] },
      evidence: [{ quote: sentence, inputPointer: "/preference/likedReasons" }],
    });
    retainExplicitAdmiration(value, input);
    expect(value.preferenceAssertions).toHaveLength(2);
    expect(preferenceCandidateSchema.parse(value)).toEqual(value);
  });

  it("does not infer admiration from ordinary liking or a negative evaluation", () => {
    const ordinary = candidate();
    retainExplicitAdmiration(ordinary, "困っている子を置いていかないところが好き。");
    expect(ordinary.preferenceAssertions).toHaveLength(1);
    const negative = candidate();
    retainExplicitAdmiration(negative, "自分が不利になっても相手を安心させるのが本当のヒーローだとは思わない。");
    expect(negative.preferenceAssertions).toHaveLength(1);
  });

  it("allows explicit hero praise to be a preference even when it also carries a value judgment", () => {
    const admiration = candidate().preferenceAssertions[0];
    admiration.responseChannel = "admiration";
    admiration.evidence[0].quote = "本当のヒーローだと思う";
    expect(isExplicitHeroPraise(admiration, input)).toBe(true);
    admiration.evidence[0].quote = "本当のヒーローだとは思わない";
    expect(isExplicitHeroPraise(admiration, input)).toBe(false);
    admiration.evidence[0].quote = "本当のヒーローだと思う";
    admiration.responseChannel = "root_for";
    expect(isExplicitHeroPraise(admiration, input)).toBe(false);
  });
});
