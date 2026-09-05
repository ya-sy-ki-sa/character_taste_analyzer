import { describe, expect, it } from "vitest";
import { frozenDarkAnalyzerFixtures, frozenOutOfScopeFixtures } from "../evaluation/fixtures/dark-analyzer-fixtures";
import { darkOntologySeeds } from "../shared/catalogs/dark-ontology";
import { darkTransformationOperationSchema } from "../shared/contracts/dark-understanding";
import { darkEntrySubmissionSchema, entrySubmissionSchema } from "../shared/contracts/entries";
import { darkResponseChannelCatalog } from "../shared/dark-response-channels";

describe("dark lab frozen evaluation fixtures", () => {
  it("freezes at least 48 in-scope cross-category cases and separate negative controls", () => {
    expect(frozenDarkAnalyzerFixtures).toHaveLength(63);
    expect(frozenOutOfScopeFixtures).toHaveLength(7);
    expect(Object.isFrozen(frozenDarkAnalyzerFixtures)).toBe(true);
    expect(new Set(frozenDarkAnalyzerFixtures.map((item) => item.archetype))).toHaveLength(9);
    expect(new Set(frozenDarkAnalyzerFixtures.map((item) => item.expected.deltaOperation))).toEqual(
      new Set(darkTransformationOperationSchema.options),
    );
    expect(new Set(frozenDarkAnalyzerFixtures.map((item) => item.id)).size).toBe(frozenDarkAnalyzerFixtures.length);
  });

  it("uses only dedicated dark ontology keys and response channels", () => {
    const ontologyKeys = new Set(darkOntologySeeds.map((item) => item.stableKey));
    const channels = new Set(darkResponseChannelCatalog.map((item) => item.value));
    expect(darkOntologySeeds.length).toBeGreaterThanOrEqual(120);
    expect(darkOntologySeeds.every((item) => item.stableKey.startsWith("dark."))).toBe(true);
    for (const fixture of frozenDarkAnalyzerFixtures) {
      expect(ontologyKeys.has(fixture.expected.ontologyKey)).toBe(true);
      expect(channels.has(fixture.expected.responseChannel)).toBe(true);
    }
  });
});

describe("dark entry contract", () => {
  const draft = {
    registrationType: "customized_existing" as const,
    workTitle: "凍結fixture作品",
    baseCharacterName: "光の勇者",
    characterName: "支配された勇者",
    representationType: "scene_state" as const,
    customizationDescription: "洗脳されて元味方と敵対している期間",
    identityResolution: { mode: "new" as const },
    darkContext: {
      focusDescription: "洗脳下で元味方と敵対する状態",
      archetypeHints: ["controlled_hero" as const],
      beforeState: "仲間を守る勇者",
      transitionTrigger: "敵による洗脳",
      controllerOrInfluence: "敵の術者",
      controlMechanism: "暗示と命令",
      awarenessAndResistance: "自我が残り内側で抵抗する",
    },
    preference: {
      likedReasons: "正義が反転している点と残った抵抗が好き",
      responseChannels: ["controlled_state_fascination" as const, "inner_resistance_fascination" as const],
    },
  };

  it("requires a named dark state and accepts dedicated channels", () => {
    expect(darkEntrySubmissionSchema.safeParse(draft).success).toBe(true);
    expect(
      darkEntrySubmissionSchema.safeParse({ ...draft, darkContext: { ...draft.darkContext, focusDescription: "" } })
        .success,
    ).toBe(false);
  });

  it("does not cross-map a dark draft into the standard entry contract", () => {
    expect(entrySubmissionSchema.safeParse(draft).success).toBe(false);
  });
});
