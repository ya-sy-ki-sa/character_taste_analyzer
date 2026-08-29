import { describe, expect, it } from "vitest";
import {
  entryDraftSchema,
  generatedCharacterCandidateSchema,
  generationRequestInputSchema,
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
      knownScope: "第7話の裏人格",
      sourceText: "善への無関心を貫くヴィラン。",
      preference: {
        likedReasons: "純粋悪であることが好き",
        responseChannels: ["fascination_with_transgression", "desire_no_redemption"],
        valueStanceNote: "フィクション上の悪を肯定する",
      },
    });
    expect(result.registrationType).toBe("customized_existing");
    expect(result.preference.responseChannels).toContain("desire_no_redemption");
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
