import { describe, expect, it } from "vitest";
import type { PreferenceCandidate } from "../shared/contracts/preference";
import {
  isSelfBackgroundPreference,
  uniquePreferenceIndexes,
  withConciseComparison,
  withConcretePreferenceCondition,
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
      "ずっと乱暴な人よりそのときに踏ん張る人を応援したい",
    ]);
  });

  it("keeps concrete routes when a broad ontology label replaces the source wording", () => {
    const growth = assertion("成長", "修行してできることを増やしていくのも好き。");
    expect(withConcretePreferenceCondition(growth).context.conditions).toEqual(["修行してできることを増やす"]);
    expect(
      withConcretePreferenceCondition(assertion("修行による能力向上", "修行してできることを増やしていくのも好き。"))
        .context.conditions,
    ).toEqual(["修行してできることを増やす"]);
    const protective = assertion("保護的", "ぶっきらぼうでも行動で守ってくれるところに憧れる。");
    protective.context.conditions = ["ぶっきらぼうな態度であっても"];
    expect(withConcretePreferenceCondition(protective).context.conditions).toEqual([
      "ぶっきらぼうな態度であっても",
      "ぶっきらぼうでも行動で守る",
    ]);
    expect(withConcretePreferenceCondition(assertion("成長", "成長が好き。"))).toEqual(
      assertion("成長", "成長が好き。"),
    );
  });

  it("collapses the A14 purpose paraphrase without discarding another condition", () => {
    const item = assertion(
      "誰かを助けるための力の使用",
      "力を手に入れることより、誰かを助けるために力を使うところが好き。",
    );
    item.context.conditions = [
      "力を手に入れることより誰かを助けるために力を使うところを優先",
      "力を手に入れることより、助けるために力を使うことを優先して評価",
      "弟のために考える場面",
    ];
    expect(withConciseComparison(item).context.conditions).toEqual([
      "力を手に入れることより誰かを助けるために力を使うところを優先",
      "弟のために考える場面",
    ]);
  });

  it("removes an A14 acquisition paraphrase and an unsupported absence-of-evaluation note", () => {
    const item = assertion(
      "誰かを助けるために力を使うこと",
      "力を手に入れることより、誰かを助けるために力を使うところが好き。",
    );
    item.context.conditions = [
      "力を手に入れることより誰かを助けるために力を使うところを優先",
      "力を手に入れることより、力を誰かを助けるために使うことを好む。力を手に入れること自体への評価は示されていない。",
    ];
    expect(withConciseComparison(item).context.conditions).toEqual([
      "力を手に入れることより誰かを助けるために力を使うところを優先",
    ]);
  });

  it("projects the A09 and A11 source comparisons once and keeps the A14 axis", () => {
    const a09 = assertion(
      "食事を通じた援助",
      "料理で人を元気にするのがいい。戦う強さだけじゃなく、食べさせて助けるヒーローっぽさが好き。",
    );
    a09.context.conditions = [
      "戦う強さだけでなく、食事を通じて助けること",
      "戦う強さだけでなく食べさせて助けるヒーローっぽさも評価",
    ];
    const a09Result = withConciseComparison(a09);
    expect(a09Result.context.conditions).toEqual(["戦う強さだけでなく食べさせて助けるヒーローっぽさも評価"]);
    expect(withConciseComparison(a09Result).context.conditions).toEqual(a09Result.context.conditions);

    const a11 = assertion(
      "大切な人のためにその場で踏ん張ること",
      "ずっと乱暴な人より、そのときに踏ん張る人を応援したい。",
    );
    a11.context.conditions = [
      "いつも乱暴な人物より優先して応援したい",
      "ずっと乱暴な人よりそのときに踏ん張る人を応援したいを優先",
    ];
    const a11Result = withConciseComparison(a11);
    expect(a11Result.context.conditions).toEqual(["ずっと乱暴な人よりそのときに踏ん張る人を応援したい"]);
    expect(withConciseComparison(a11Result).context.conditions).toEqual(a11Result.context.conditions);

    const a14 = assertion(
      "誰かを助けるために力を使うこと",
      "力を手に入れることより、誰かを助けるために力を使うところが好き。",
    );
    a14.context.conditions = ["力を手に入れることより誰かを助けるために力を使うところを優先"];
    expect(withConciseComparison(a14).context.conditions).toEqual(a14.context.conditions);
  });

  it("deduplicates the live A09/A11/A14 paraphrases without losing A11's distinct condition", () => {
    const a09 = assertion(
      "食事を与えて人を助けること",
      "料理で人を元気にするのがいい。戦う強さだけでなく食べさせて助けるヒーローっぽさが好き。",
    );
    a09.context.conditions = [
      "戦う強さだけでなく食べさせて助けるヒーローっぽさも評価",
      "戦う強さだけでなく、食事による援助も評価対象",
    ];
    expect(withConciseComparison(a09).context.conditions).toEqual([
      "戦う強さだけでなく食べさせて助けるヒーローっぽさも評価",
    ]);

    const a11 = assertion(
      "その場で踏ん張ること",
      "ずっと乱暴な人より、そのときに踏ん張る人を応援したい。大事な人のために勇気を出すところが好き。",
    );
    a11.context.conditions = [
      "ずっと乱暴な人よりそのときに踏ん張る人を応援したい",
      "大切な人のために勇気を出す場面で踏ん張ること。ずっと乱暴な人物よりも、そのような人物を応援したいという比較。",
    ];
    expect(withConciseComparison(a11).context.conditions).toEqual([
      "ずっと乱暴な人よりそのときに踏ん張る人を応援したい",
      "大切な人のために勇気を出す場面で踏ん張ること",
    ]);

    const a14 = assertion(
      "誰かを助けるために力を使うこと",
      "力を手に入れることより、誰かを助けるために力を使うところが好き。",
    );
    a14.context.conditions = [
      "力を手に入れることより誰かを助けるために力を使うところを優先",
      "力を手に入れることよりも、その力を使う目的を重視する比較",
    ];
    expect(withConciseComparison(a14).context.conditions).toEqual([
      "力を手に入れることより誰かを助けるために力を使うところを優先",
    ]);
  });

  it("separates negation and descriptive contrast from a stated preference", () => {
    const denied = assertion("比較の否定", "戦う強さより助けることが好きではない。");
    denied.context.conditions = ["負傷時"];
    expect(withConciseComparison(denied).context.conditions).toEqual(["負傷時"]);
    expect(
      withConciseComparison(assertion("比較の否定", "戦う強さより助けることが好きだとは思わない。")).context.conditions,
    ).toEqual([]);

    const descriptive = assertion("優しさ", "強さだけでなく優しさもある。優しいところが好き。");
    descriptive.context.conditions = ["普段は優しい"];
    expect(withConciseComparison(descriptive).context.conditions).toEqual(["普段は優しい"]);

    const negative = assertion("乱暴さ", "乱暴な人より優しい人が好き。");
    negative.polarity = "negative";
    expect(withConciseComparison(negative).context.conditions).toEqual([]);
  });

  it("keeps genuinely different preferred targets on the same comparison axis", () => {
    const distinct = assertion(
      "食事と共感",
      "戦う強さだけでなく、食べさせて助けるところが好き。戦う強さだけでなく、人に寄り添うところも好き。",
    );
    distinct.context.conditions = [
      "戦う強さだけでなく食事を通じて助けること",
      "戦う強さだけでなく人に寄り添うこと",
      "戦う強さだけでなく知恵を使うこと",
      "比較条件：優しさだけでなく食べさせて助けるところ",
    ];
    expect(withConciseComparison(distinct).context.conditions).toEqual([
      "戦う強さだけでなく食べさせて助けるところも評価",
      "戦う強さだけでなく人に寄り添うところも評価",
      "戦う強さだけでなく知恵を使うこと",
      "比較条件：優しさだけでなく食べさせて助けるところ",
    ]);

    const differentObject = assertion("救助", "力の獲得より弟を助けるところが好き。");
    differentObject.context.conditions = ["力の獲得より友を助けること"];
    expect(withConciseComparison(differentObject).context.conditions).toEqual([
      "力の獲得より弟を助けるところを優先",
      "力の獲得より友を助けること",
    ]);

    const differentFoodRecipient = assertion("食事で助ける", "戦う強さだけでなく、食べさせて兄を助けるところが好き。");
    differentFoodRecipient.context.conditions = ["戦う強さだけでなく食べさせて弟を助けること"];
    expect(withConciseComparison(differentFoodRecipient).context.conditions).toEqual([
      "戦う強さだけでなく食べさせて兄を助けるところも評価",
      "戦う強さだけでなく食べさせて弟を助けること",
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
