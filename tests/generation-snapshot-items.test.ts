import { describe, expect, it } from "vitest";
import type { GenerationSnapshotItem } from "../shared/contracts/generation-response";
import { expandSnapshotTreatments, groupGenerationSnapshotItems } from "../src/lib/generation-snapshot-items";

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
  it.each(["dimension", "negative_preference"])("retains an unresolved marker for mixed %s selections", (type) => {
    const known = item({ type });
    const unknown = item({ type, payload: { responseChannel: null, condition: {} } });
    for (const rows of [
      [known, unknown],
      [unknown, known],
    ]) {
      const groups = groupGenerationSnapshotItems(rows);
      expect(groups[0]).toMatchObject({ hasUnresolvedResponseChannel: true, responseChannels: ["narrative_interest"] });
      expect(expandSnapshotTreatments(groups, { [groups[0].id]: "include" }).selectedItemIds).toEqual(
        rows.map((row) => row.id),
      );
    }
    expect(
      groupGenerationSnapshotItems([item({ type: "value_stance", payload: {} })])[0].hasUnresolvedResponseChannel,
    ).toBe(false);
  });
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
