import { describe, expect, it } from "vitest";
import { generatedCharacterSchema, traitExtractionSchema } from "../shared/schemas";
import { localGeneratedCharacter, localTraitExtraction } from "../worker/llm/local";

describe("grounded local analysis fallback", () => {
  it("uses only exact source substrings as evidence", () => {
    const entry = {
      kind: "existing" as const,
      workTitle: "架空作品",
      characterName: "架空人物",
      mediumOrEdition: undefined,
      overview: "寡黙だが仲間を守る責任感の強い人物です。",
      likedAspects: "不器用な優しさと、少しずつ心を開くところが好きです。",
      dislikedAspects: "衝動的に動くところは少し苦手です。",
    };
    const result = traitExtractionSchema.parse(localTraitExtraction(entry));
    const source = {
      overview: entry.overview,
      likedAspects: entry.likedAspects,
      dislikedAspects: entry.dislikedAspects,
    };
    for (const item of result.assertions) expect(source[item.evidence.field]).toContain(item.evidence.quote);
    for (const item of result.preferences) expect(source[item.evidence.field]).toContain(item.evidence.quote);
  });

  it("never converts overview occurrence into an explicit like", () => {
    const result = localTraitExtraction({
      kind: "original",
      characterName: undefined,
      overview: "正義を信じ、仲間を守る優しい人物として描かれる。",
      likedAspects: undefined,
      dislikedAspects: undefined,
    });
    expect(result.assertions.length).toBeGreaterThan(0);
    expect(result.preferences).toEqual([]);
  });
});

describe("local generation fallback", () => {
  it("produces the same schema-compliant character for the same brief", () => {
    const brief = {
      primaryTraitIds: ["temperament.warm", "values.duty"],
      supportingTraitIds: ["relationship.gradual_trust"],
      avoidTraitIds: ["temperament.impulsive"],
      explorationTraitIds: ["aesthetic.scifi"],
      mode: "balanced",
    };
    const first = generatedCharacterSchema.parse(localGeneratedCharacter(brief));
    const second = generatedCharacterSchema.parse(localGeneratedCharacter(brief));
    expect(first).toEqual(second);
    expect(first.tasteRationale.map((item) => item.traitId)).toEqual(brief.primaryTraitIds);
  });
});
