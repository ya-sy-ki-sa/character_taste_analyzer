import { describe, expect, it } from "vitest";
import {
  preferenceContextEntries,
  preferenceContextLabel,
  preferenceContextRecord,
  preferenceTargetLabel,
} from "../shared/preference-context";
import { graphNodeLabel, snapshotItemLabel } from "../shared/presentation-labels";

describe("saved preference context compatibility", () => {
  it("reads legacy scope and current named roles without losing exceptions", () => {
    const context = {
      schemaVersion: "2",
      entryScope: "旧友として",
      subjects: ["ヒューズ", "ロイ"],
      relationships: ["ヒューズがロイに接する"],
      narrativePhases: ["再会時"],
      conditions: ["ユーザーの現在の解釈"],
      exceptions: ["公式の恋愛関係ではない"],
    };
    expect(preferenceContextEntries(JSON.stringify(context))).toHaveLength(6);
    expect(preferenceContextLabel(context)).toContain("関係：ヒューズがロイに接する");
    expect(preferenceContextLabel({ ...context, relationships: ["ロイがヒューズに接する"] })).not.toBe(
      preferenceContextLabel(context),
    );
    expect(preferenceContextEntries({ scope: "限定場面", entryScope: "限定場面", metadata: "非表示" })).toEqual([
      ["対象範囲", "限定場面"],
    ]);
    for (const value of [null, undefined, "{", [], { subjects: [3, null], conditions: false }])
      expect(preferenceContextEntries(value)).toEqual([]);
    expect(preferenceContextRecord('{"scope":"過去"}')).toEqual({ scope: "過去" });
  });
  it("uses saved scope for unknown keys without guessing from the key or moral orientation", () => {
    const target = "relationship.unknown";
    const labels = new Map([["agency.proactive", "主体的"]]);
    expect(preferenceTargetLabel("agency.proactive", labels, { relationships: ["別の説明"] })).toBe("主体的");
    expect(preferenceTargetLabel("相互信頼", labels)).toBe("相互信頼");
    expect(preferenceTargetLabel(target, labels)).toBe("対象未確認");
    for (const relationship of ["相互信頼", "支配・服従"]) {
      const scope = { relationships: [relationship], conditions: ["関係の描写"] };
      expect(preferenceTargetLabel(target, labels, scope)).toBe(relationship);
      expect(
        snapshotItemLabel({
          type: "value_stance",
          label: `${target}：reject`,
          stableKey: target,
          payload: { targetRef: target, orientation: "mixed", stance: "reject", scope },
        }),
      ).toBe(`${relationship}：支持しない`);
      expect(
        graphNodeLabel({
          id: target,
          type: "value_stance",
          label: `${target}：reject`,
          attributes: { targetRef: target, stance: "reject", ...scope },
        }),
      ).toBe(`${relationship}：支持しない`);
    }
  });
});
