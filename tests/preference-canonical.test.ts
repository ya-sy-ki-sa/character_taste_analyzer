import { describe, expect, it } from "vitest";
import type { PreferenceCandidate } from "../shared/contracts/preference";
import {
  isSelfBackgroundPreference,
  uniquePreferenceIndexes,
  withConciseComparison,
} from "../worker/features/analysis/preference-canonical";

const assertion = (rawLabel: string, quote: string): PreferenceCandidate["preferenceAssertions"][number] => ({
  attributeStableKey: null,
  rawLabel,
  polarity: "positive",
  responseChannel: null,
  strength: 0.6,
  explicitness: "user_explicit",
  confidence: 0.9,
  context: {
    schemaVersion: "2",
    entryScope: null,
    subjects: ["人物A"],
    relationships: [],
    narrativePhases: [],
    conditions: [],
    exceptions: [],
  },
  evidence: [
    {
      sourceRef: "user_input",
      sourceUrl: null,
      inputPointer: "/preference/likedReasons",
      quote,
      inferenceType: "direct",
    },
  ],
});

describe("preference candidate boundaries", () => {
  it("keeps the user's inferiority as background while allowing a character's trait", () => {
    expect(
      isSelfBackgroundPreference(assertion("背の低さへの引け目", "自分も背のことで引け目があるから頑張れる")),
    ).toBe(true);
    expect(isSelfBackgroundPreference(assertion("背の低さを補う工夫", "背が高くないのに工夫するところが好き"))).toBe(
      false,
    );
    expect(isSelfBackgroundPreference(assertion("劣等感", "人物Aの劣等感が好き。自分にも似た経験がある"))).toBe(false);
    expect(
      isSelfBackgroundPreference(
        assertion(
          "自分の失敗を人のせいにせず対処しようとする姿勢",
          "自分の失敗を人のせいにしないで何とかしようとする姿に憧れる。",
        ),
      ),
    ).toBe(false);
  });

  it("projects typed comparison meanings into short conditions", () => {
    const inclusive = withConciseComparison(
      assertion("料理による援助", "戦う強さだけじゃなく、食べさせて助けるヒーローっぽさが好き。"),
    );
    expect(inclusive.context.conditions).toEqual(["戦う強さだけでなく食べさせて助けるヒーローっぽさも評価"]);
    const preferred = withConciseComparison(
      assertion("力の使用目的", "過去を責めない。力を手に入れることより、誰かを助けるために力を使うところが好き。"),
    );
    expect(preferred.context.conditions).toEqual(["力を手に入れることより誰かを助けるために力を使うところを優先"]);
    expect(
      withConciseComparison(assertion("改心しない姿", "改心するのではなく、そのままでいるところが好き")).context
        .conditions,
    ).toEqual([]);
    expect(
      withConciseComparison(
        assertion(
          "ロイを肩書きより本人として見る旧友らしさ",
          "ロイの肩書きより本人を見て、遠慮なく話す旧友らしさが好き",
        ),
      ).context.conditions,
    ).toEqual([]);
    const repeated = assertion(
      "誰かを助けるために力を使うこと",
      "力を手に入れることより、誰かを助けるために力を使うところが好き。",
    );
    repeated.context.conditions = ["力を手に入れることよりも、助けるために使うことを評価"];
    expect(withConciseComparison(repeated).context.conditions).toEqual([
      "力を手に入れることより誰かを助けるために力を使うところを優先",
    ]);
    const inclusiveRepeated = assertion(
      "食事を与えて人を助けること",
      "料理で人を元気にするのがいい。戦う強さだけでなく食べさせて助けるヒーローっぽさが好き。",
    );
    inclusiveRepeated.context.conditions = ["戦う強さだけでなく、食べさせて助ける面も評価する"];
    expect(withConciseComparison(inclusiveRepeated).context.conditions).toEqual([
      "戦う強さだけでなく食べさせて助けるヒーローっぽさも評価",
    ]);
    const cheering = assertion(
      "必要なときに踏ん張ること",
      "普段は優しいのに、大事な人のために勇気を出すところが好き。ずっと乱暴な人より、そのときに踏ん張る人を応援したい。",
    );
    cheering.context.conditions = ["ずっと乱暴な人物より、そのときに踏ん張る人物を応援する比較"];
    expect(withConciseComparison(cheering).context.conditions).toEqual([
      "ずっと乱暴な人よりそのときに踏ん張る人を応援したいを優先",
    ]);
  });

  it("merges only the same target, channel, polarity, scope and evidence", () => {
    const base = assertion("主体的な行動", "自分から動くところが好き");
    expect(
      uniquePreferenceIndexes([
        base,
        { ...base, rawLabel: " 主体的な行動 " },
        { ...base, responseChannel: "admiration" },
      ]),
    ).toEqual([0, 2]);
  });
});
