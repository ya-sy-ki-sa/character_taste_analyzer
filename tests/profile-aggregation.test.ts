import { describe, expect, it } from "vitest";
import type { ProfileDimension } from "../shared/contracts/profile-response";
import { groupProfileDimensions } from "../src/lib/profile-dimensions";
import { profileConditionJson } from "../worker/features/profile/context";

function dimension(overrides: Partial<ProfileDimension> = {}): ProfileDimension {
  return {
    id: crypto.randomUUID(),
    stableKey: "change.corruption",
    label: "堕落",
    category: "change",
    responseChannel: "narrative_interest",
    condition: {},
    positiveScore: 0.6,
    negativeScore: 0,
    confidence: 0.5,
    evidenceCount: 1,
    identityCount: 1,
    workCount: 1,
    classification: "emerging",
    flags: [],
    ...overrides,
  };
}

describe("profile aggregation", () => {
  it("uses only the current structured context as an aggregation condition", () => {
    expect(profileConditionJson(null)).toBe("{}");
    expect(profileConditionJson(" キャラクター全体 ")).toBe("{}");
    expect(JSON.parse(profileConditionJson('{"schemaVersion":"2","entryScope":"闇堕ちしている期間"}'))).toEqual({
      schemaVersion: "2",
      entryScope: "闇堕ちしている期間",
    });
  });

  it("shows one attribute row with all of its response channels", () => {
    const grouped = groupProfileDimensions([
      dimension(),
      dimension({ responseChannel: "emotional_impact", evidenceCount: 2, confidence: 0.7 }),
      dimension({
        responseChannel: "fascination_with_transgression",
        condition: { schemaVersion: "2", entryScope: "闇堕ちしている期間" },
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe("堕落");
    expect(grouped[0].responseChannels).toEqual([
      "narrative_interest",
      "emotional_impact",
      "fascination_with_transgression",
    ]);
    expect(grouped[0].evidenceCount).toBe(4);
    expect(grouped[0].confidence).toBe(0.7);
    expect(grouped[0].conditions).toEqual([{}, { schemaVersion: "2", entryScope: "闇堕ちしている期間" }]);
  });
});
