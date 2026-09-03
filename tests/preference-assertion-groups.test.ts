import { describe, expect, it } from "vitest";
import { groupPreferenceAssertions } from "../src/lib/preference-assertion-groups";

function assertion(id: string, rawLabel: string, stableKey: string | null) {
  return { id, raw_label: rawLabel, stable_key: stableKey };
}

describe("preference assertion review grouping", () => {
  it("groups one ontology attribute while retaining each response assertion", () => {
    const groups = groupPreferenceAssertions([
      assertion("explicit", "ヴィラン", "role.villain"),
      assertion("emotional", "ヴィラン", "role.villain"),
      assertion("immersion", "ヴィラン的な役割", "role.villain"),
      assertion("mask", "仮面・表裏", "motif.mask"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: "ヴィラン", stableKey: "role.villain" });
    expect(groups[0].items.map((item) => item.id)).toEqual(["explicit", "emotional", "immersion"]);
  });

  it("groups unmapped labels after Japanese-compatible normalization", () => {
    const groups = groupPreferenceAssertions([
      assertion("first", "黒い コスチューム", null),
      assertion("second", "黒い　コスチューム ", null),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });
});
