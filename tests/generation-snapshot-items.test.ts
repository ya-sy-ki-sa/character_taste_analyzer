import { describe, expect, it } from "vitest";
import {
  expandSnapshotTreatments,
  type GenerationSnapshotItem,
  groupGenerationSnapshotItems,
} from "../src/lib/generation-snapshot-items";

function item(overrides: Partial<GenerationSnapshotItem> = {}): GenerationSnapshotItem {
  return {
    id: crypto.randomUUID(),
    type: "dimension",
    stableKey: "change.corruption",
    label: "堕落",
    payload: { responseChannel: "narrative_interest", condition: {} },
    ...overrides,
  };
}

describe("generation snapshot item grouping", () => {
  it("groups the same attribute while retaining channels, scopes, and source ids", () => {
    const first = item();
    const second = item({
      payload: {
        responseChannel: "fascination_with_transgression",
        condition: { schemaVersion: "2", entryScope: "闇堕ちしている期間" },
      },
    });
    const negative = item({ type: "negative_preference" });

    const groups = groupGenerationSnapshotItems([first, second, negative]);

    expect(groups).toHaveLength(2);
    expect(groups[0].itemIds).toEqual([first.id, second.id]);
    expect(groups[0].responseChannels).toEqual(["narrative_interest", "fascination_with_transgression"]);
    expect(groups[0].conditions).toEqual([{}, { schemaVersion: "2", entryScope: "闇堕ちしている期間" }]);
  });

  it("expands one displayed selection to every underlying snapshot item", () => {
    const groups = groupGenerationSnapshotItems([item({ id: crypto.randomUUID() }), item({ id: crypto.randomUUID() })]);
    const result = expandSnapshotTreatments(groups, { [groups[0].id]: "include" });

    expect(result.selectedItemIds).toEqual(groups[0].itemIds);
    expect(result.prohibitedItemIds).toEqual([]);
  });
});
