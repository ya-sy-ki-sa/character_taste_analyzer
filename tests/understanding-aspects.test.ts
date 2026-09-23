import { describe, expect, it } from "vitest";
import { understandingAssertionAspects } from "../worker/features/analysis/understanding-aspects";

describe("model-knowledge understanding projection", () => {
  it("does not treat a hero's enemies as a relationship description", () => {
    expect(
      understandingAssertionAspects({
        attributeStableKey: "role.hero",
        rawLabel: "ヒーロー",
        valueText: "仲間や地球を脅かす敵に立ち向かう物語の主人公。",
        scopeText: "",
        explicitness: "model_knowledge",
      }),
    ).toEqual(["narrativeRole"]);
  });

  it("honors the explicit values and relationship aspect labels", () => {
    const basic = { attributeStableKey: null, scopeText: "", explicitness: "model_knowledge" as const };
    expect(
      understandingAssertionAspects({
        ...basic,
        rawLabel: "重視する価値観",
        valueText: "仲間とのつながりを大切にし、強さを試すことを重んじる。",
      }),
    ).toEqual(["values"]);
    expect(
      understandingAssertionAspects({
        ...basic,
        rawLabel: "他者との関係",
        valueText: "家族や仲間を大切にし、ベジータと競い合う。",
      }),
    ).toEqual(["relationships"]);
    expect(
      understandingAssertionAspects({
        ...basic,
        rawLabel: "人々に希望を与えるヒーロー像",
        valueText: "オールマイトのように安心を与える理想を尊び、自分も近づこうとする。",
      }),
    ).toEqual(["values"]);
    expect(
      understandingAssertionAspects({
        ...basic,
        rawLabel: "観察と分析",
        valueText: "相手の特徴を観察し、得た情報を戦い方に活用する。",
      }),
    ).toEqual(["behavior"]);
    expect(
      understandingAssertionAspects({
        ...basic,
        rawLabel: "控えめさと熱中時の表現",
        valueText: "普段は控えめだが、ヒーローの話題では言葉に熱がこもる。",
      }),
    ).toEqual(["expression"]);
  });
});
