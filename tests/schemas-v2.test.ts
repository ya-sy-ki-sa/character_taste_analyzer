import { describe, expect, it } from "vitest";
import { responseChannelCatalog, responseChannelCategories } from "../shared/response-channels";
import {
  entryDraftSchema,
  generatedCharacterCandidateSchema,
  generationRequestInputSchema,
  responseChannelSchema,
  understandingCandidateSchema,
} from "../shared/schemas";

describe("v2 input contracts", () => {
  it("accepts a customized villain preference without moral normalization", () => {
    const result = entryDraftSchema.parse({
      schemaVersion: "1",
      registrationType: "customized_existing",
      workTitle: "架空作品",
      characterName: "悪役A",
      representationType: "facet",
      customizationDescription: "改心しない裏人格だけ",
      preferenceContext: "第7話で裏人格が現れている間",
      referenceMaterial: "善への無関心を貫くヴィラン。",
      preference: {
        likedReasons: "純粋悪であることが好き",
        responseChannels: ["fascination_with_transgression", "desire_no_redemption"],
        valueStanceNote: "フィクション上の悪を肯定する",
      },
    });
    expect(result.registrationType).toBe("customized_existing");
    expect(result.preference.responseChannels).toContain("desire_no_redemption");
  });

  it("accepts an entry without a preferred time, scene, or state", () => {
    const result = entryDraftSchema.parse({
      schemaVersion: "1",
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
      schemaVersion: "1",
      registrationType: "original",
      characterName: "オリジナルA",
      preference: { responseChannels: [] },
    });
    expect(result.success).toBe(false);
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

  it("requires structured generation coverage", () => {
    const parsed = generatedCharacterCandidateSchema.safeParse({ schemaVersion: "1.0", briefId: crypto.randomUUID() });
    expect(parsed.success).toBe(false);
  });
});
