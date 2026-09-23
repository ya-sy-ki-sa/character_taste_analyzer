import { describe, expect, it } from "vitest";
import { preferenceCandidateSchema } from "../shared/contracts/preference";
import { linkGrowthToSupport } from "../worker/features/analysis/preference-growth-link";

const growth = "自分からうまくなろうとするところが特にいい。";
const support = "部活を頑張る仲間として応援している。";
const reason = `影山に全部任せるんじゃなく、${growth}二人の恋愛を想像しているわけではなく、${support}`;
const evidence = (quote: string) => ({
  sourceRef: "input:/preference/likedReasons",
  inputPointer: "/preference/likedReasons",
  sourceUrl: null,
  quote,
  inferenceType: "direct" as const,
});
const context = (subjects: string[]) => ({
  schemaVersion: "2" as const,
  entryScope: null,
  subjects,
  relationships: [],
  narrativePhases: [],
  conditions: [],
  exceptions: ["二人の恋愛を想像していない"],
});

function candidate(growthSubjects = ["日向翔陽"], supportSubjects = ["日向翔陽", "影山飛雄"]) {
  return preferenceCandidateSchema.parse({
    summary: { userExplicitSummary: [], inferredSummary: [], limitations: [] },
    preferenceAssertions: [
      {
        attributeStableKey: "agency.proactive",
        rawLabel: "主体的な上達",
        polarity: "positive",
        responseChannel: null,
        strength: 0.6,
        explicitness: "user_explicit",
        confidence: 0.9,
        context: context(growthSubjects),
        evidence: [evidence(growth)],
      },
      {
        attributeStableKey: null,
        rawLabel: "部活動に励む姿",
        polarity: "positive",
        responseChannel: "root_for",
        strength: 0.6,
        explicitness: "user_explicit",
        confidence: 0.9,
        context: context(supportSubjects),
        evidence: [evidence(support)],
      },
    ],
    valueStanceAssertions: [],
    uncertainties: [],
  });
}

describe("growth-to-support relation", () => {
  it("links adjacent praise and root_for using both exact input quotes", () => {
    const value = candidate();
    linkGrowthToSupport(value, reason, "日向翔陽");
    const root = value.preferenceAssertions[1];
    expect(root.context.conditions).toContain("自分からうまくなろうとするところを仲間として応援");
    expect(root.evidence.map((item) => item.quote)).toEqual([support, growth]);
    expect(root.context.exceptions).toContain("二人の恋愛を想像していない");
    expect(value.preferenceAssertions[0].responseChannel).toBeNull();
    linkGrowthToSupport(value, reason, "日向翔陽");
    expect(root.evidence).toHaveLength(2);
  });

  it("does not join a different person or a separate intervening topic", () => {
    const other = candidate(["影山飛雄"]);
    linkGrowthToSupport(other, reason, "日向翔陽");
    expect(other.preferenceAssertions[1].context.conditions).toEqual([]);
    const separate = candidate();
    linkGrowthToSupport(separate, `${growth}別の話題が好き。${support}`, "日向翔陽");
    expect(separate.preferenceAssertions[1].context.conditions).toEqual([]);
  });
});
