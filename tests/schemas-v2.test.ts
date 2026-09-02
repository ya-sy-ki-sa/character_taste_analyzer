import { describe, expect, it } from "vitest";
import { responseChannelCatalog, responseChannelCategories } from "../shared/response-channels";
import {
  canonicalEntryInputPointer,
  entryBaseCharacterName,
  entryDraftSchema,
  entryInputSources,
  entryReanalysisSchema,
  generatedCharacterCandidateSchema,
  generationRequestInputSchema,
  loginSchema,
  responseChannelSchema,
  understandingCandidateSchema,
  understandingReviewMutationSchema,
} from "../shared/schemas";

describe("current input contracts", () => {
  it("accepts login by username and rejects the removed user ID contract", () => {
    const accessKey = crypto.randomUUID();
    expect(loginSchema.safeParse({ username: "ログインユーザー", accessKey }).success).toBe(true);
    expect(loginSchema.safeParse({ userId: crypto.randomUUID(), accessKey }).success).toBe(false);
  });

  it("persists every citable customized-entry field with canonical pointers", () => {
    const draft = entryDraftSchema.parse({
      registrationType: "customized_existing",
      workTitle: "NARUTO",
      baseCharacterName: "うずまきナルト",
      characterName: "暁ナルト",
      representationType: "transformative",
      customizationDescription: "犯罪組織「暁」に所属しているナルト",
      identityResolution: { mode: "new" },
      preference: { likedReasons: "悪の道を歩むif", responseChannels: [] },
    });
    const sources = new Map(entryInputSources(draft).map((source) => [source.pointer, source.text]));
    expect(sources.get("/workTitle")).toBe("NARUTO");
    expect(sources.get("/baseCharacterName")).toBe("うずまきナルト");
    expect(sources.get("/characterName")).toBe("暁ナルト");
    expect(sources.get("/customizationDescription")).toContain("犯罪組織");
    expect(sources.get("/preference/likedReasons")).toBe("悪の道を歩むif");
    expect(canonicalEntryInputPointer("/登録情報/customizationDescription")).toBe("/customizationDescription");
  });

  it("requires a base character name for a customized entry", () => {
    const result = entryDraftSchema.safeParse({
      registrationType: "customized_existing",
      workTitle: "NARUTO",
      characterName: "暁ナルト",
      representationType: "transformative",
      customizationDescription: "犯罪組織「暁」に所属しているナルト",
      identityResolution: { mode: "new" },
      preference: { responseChannels: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a customized villain preference without moral normalization", () => {
    const result = entryDraftSchema.parse({
      registrationType: "customized_existing",
      workTitle: "架空作品",
      baseCharacterName: "悪役A",
      characterName: "悪役A",
      representationType: "facet",
      customizationDescription: "改心しない裏人格だけ",
      identityResolution: { mode: "new" },
      preferenceContext: "第7話で裏人格が現れている間",
      referenceMaterial: "善への無関心を貫くヴィラン。",
      preference: {
        likedReasons: "純粋悪であることが好き",
        responseChannels: ["fascination_with_transgression", "desire_no_redemption"],
        valueStanceNote: "フィクション上の悪を肯定する",
      },
    });
    expect(result.registrationType).toBe("customized_existing");
    expect(entryBaseCharacterName(result)).toBe("悪役A");
    expect(result.preference.responseChannels).toContain("desire_no_redemption");
  });

  it("accepts an entry without a preferred time, scene, or state", () => {
    const result = entryDraftSchema.parse({
      registrationType: "original",
      characterName: "オリジナルA",
      characterBasicInfo: "自分の価値観に忠実で、未知の世界を旅する人物。",
      preference: { responseChannels: ["person_liking"] },
    });
    expect(result.preferenceContext).toBeUndefined();
    expect(result.referenceMaterial).toBeUndefined();
  });

  it("requires basic character information for an original character", () => {
    const result = entryDraftSchema.safeParse({
      registrationType: "original",
      characterName: "オリジナルA",
      preference: { responseChannels: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all revised entry inputs for reanalysis", () => {
    const result = entryReanalysisSchema.parse({
      draft: {
        registrationType: "original",
        characterName: "再入力したキャラクター",
        characterBasicInfo: "再入力した基本情報",
        referenceMaterial: "追加した参考情報",
        userCharacterView: "見直したキャラクター解釈",
        preference: {
          likedReasons: "思い出して追加した好きな理由",
          responseChannels: ["person_liking", "admiration"],
        },
      },
    });
    expect(result.draft.characterName).toBe("再入力したキャラクター");
    expect(result.draft.referenceMaterial).toContain("参考情報");
    expect(result.draft.preference.responseChannels).toHaveLength(2);
  });

  it("rejects removed compatibility fields", () => {
    const result = entryDraftSchema.safeParse({
      schemaVersion: "2",
      registrationType: "original",
      characterName: "旧形式",
      characterBasicInfo: "旧フィールドを含む入力",
      knownScope: "旧対象範囲",
      sourceText: "旧参考情報",
      preference: { responseChannels: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts user corrections and manual additions during understanding review", () => {
    expect(
      understandingReviewMutationSchema.parse({
        action: "update_assertion",
        targetId: crypto.randomUUID(),
        rawLabel: "修正した属性",
        valueText: "ユーザーの認識に合わせた内容",
      }),
    ).toMatchObject({ action: "update_assertion" });
    expect(
      understandingReviewMutationSchema.parse({
        action: "add_delta",
        operation: "add",
        beforeValue: null,
        afterValue: "原典にはない設定",
        reasonText: "ユーザーが明示した差分",
      }),
    ).toMatchObject({ action: "add_delta", operation: "add" });
  });

  it("rejects internally inconsistent manual deltas", () => {
    expect(
      understandingReviewMutationSchema.safeParse({
        action: "add_delta",
        operation: "add",
        beforeValue: "追加なのに原典値がある",
        afterValue: "変更後",
      }).success,
    ).toBe(false);
    expect(
      understandingReviewMutationSchema.safeParse({
        action: "update_delta",
        targetId: crypto.randomUUID(),
        operation: "modify",
        beforeValue: null,
        afterValue: "変更後だけ",
      }).success,
    ).toBe(false);
  });

  it("defines unique and categorized response channels from one catalog", () => {
    const values = responseChannelCatalog.map((item) => item.value);
    const labels = responseChannelCatalog.map((item) => item.label);
    const categoryKeys = new Set(responseChannelCategories.map((item) => item.key));
    expect(responseChannelCatalog).toHaveLength(44);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(responseChannelSchema.options)).toEqual(new Set(values));
    expect(
      responseChannelCatalog
        .filter((item) => item.tier === "detail")
        .every((item) => categoryKeys.has(item.category as (typeof responseChannelCategories)[number]["key"])),
    ).toBe(true);
  });

  it("rejects an internally invalid customization delta", () => {
    const parsed = understandingCandidateSchema.safeParse({
      sourceAssessment: { coverage: "partial", limitations: [], modelKnowledgeUsed: false },
      summary: {
        identity: "A",
        narrativeRole: [],
        moralityOrientation: [],
        goals: [],
        values: [],
        behavior: [],
        relationships: [],
        expression: [],
      },
      assertions: [],
      customizationDeltas: [
        {
          operation: "modify",
          targetAttributeStableKey: null,
          beforeValue: null,
          afterValue: "変更後",
          scopeText: "一場面",
          reasonText: null,
          explicitness: "inferred",
          confidence: 0.5,
        },
      ],
      uncertainties: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("prevents the same snapshot item from being selected and prohibited", () => {
    const id = crypto.randomUUID();
    const input = generationRequestInputSchema.safeParse({
      purpose: "テスト",
      selectedItemIds: [id],
      prohibitedItemIds: [id],
    });
    expect(input.success).toBe(false);
  });

  it("does not accept removed redemption and hidden-goodness generation controls", () => {
    const id = crypto.randomUUID();
    const input = generationRequestInputSchema.safeParse({
      purpose: "テスト",
      selectedItemIds: [id],
      redemption: "required",
      hiddenGoodness: "required",
    });
    expect(input.success).toBe(false);
  });

  it("requires structured generation coverage", () => {
    const parsed = generatedCharacterCandidateSchema.safeParse({ schemaVersion: "1.0", briefId: crypto.randomUUID() });
    expect(parsed.success).toBe(false);
  });
});
