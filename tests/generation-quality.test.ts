import { describe, expect, it } from "vitest";
import type { AnyGeneratedCharacterCandidate, GenerationValidationReport } from "../shared/schemas";
import {
  expandSnapshotTreatments,
  groupGenerationSnapshotItems,
  snapshotConditionLabel,
} from "../src/lib/generation-snapshot-items";
import { compileGenerationSelections, selectionValuePolicy } from "../worker/services/generation-selections";
import { textOverlap } from "../worker/services/generation-similarity";
import {
  GENERATION_POLICY_CHECKS,
  type GenerationCoverageBrief,
  isCharacterContentPointer,
  reconcileGenerationValidation,
} from "../worker/services/generation-validation";

const brief: GenerationCoverageBrief = {
  preferenceSelections: [
    { profileSnapshotItemId: "required", treatment: "required" },
    { profileSnapshotItemId: "prohibit", treatment: "prohibit" },
    { profileSnapshotItemId: "include", treatment: "include" },
    { profileSnapshotItemId: "explore", treatment: "explore" },
  ],
};
const candidate = {
  personality: { summary: "一貫した判断" },
  briefCoverage: brief.preferenceSelections.map((item) => ({
    ...item,
    status: "satisfied",
    outputPointers: ["/personality/summary"],
    explanation: "確認",
  })),
} as unknown as AnyGeneratedCharacterCandidate;
const report = (): GenerationValidationReport => ({
  passed: true,
  checks: [...brief.preferenceSelections.map((item) => item.profileSnapshotItemId), ...GENERATION_POLICY_CHECKS].map(
    (constraintId) => ({
      constraintId,
      status: "satisfied",
      outputPointers: ["/personality/summary"],
      explanation: "確認",
    }),
  ),
  violations: [],
});
describe("generation acceptance is derived from complete semantic checks", () => {
  it("rejects a candidate tied to a different brief", () => {
    expect(
      reconcileGenerationValidation(
        { ...brief, briefId: "expected" },
        { ...candidate, briefId: "unexpected" },
        report(),
      ).passed,
    ).toBe(false);
    expect(
      reconcileGenerationValidation({ ...brief, briefId: "expected" }, { ...candidate, briefId: "expected" }, report())
        .passed,
    ).toBe(true);
  });
  it("accepts complete checks; exploratory uncertainty is permitted", () => {
    expect(reconcileGenerationValidation(brief, candidate, report()).passed).toBe(true);
    const value = report();
    value.checks[3].status = "uncertain";
    expect(reconcileGenerationValidation(brief, candidate, value).passed).toBe(true);
  });
  it.each([0, 1, 2, 3, 4])("rejects violated check %i despite passed true", (index) => {
    const value = report();
    value.checks[index].status = "violated";
    expect(reconcileGenerationValidation(brief, candidate, value).passed).toBe(false);
  });
  it.each([0, 1, 4])("fails closed when mandatory/prohibited/policy check %i is uncertain", (index) => {
    const value = report();
    value.checks[index].status = "uncertain";
    expect(reconcileGenerationValidation(brief, candidate, value).passed).toBe(false);
  });
  it("rejects omissions, duplicate and unknown IDs, bad pointers and contradictory summary", () => {
    const omitted = report();
    omitted.checks.pop();
    const duplicate = report();
    duplicate.checks.push(duplicate.checks[0]);
    const unknown = report();
    unknown.checks[0].constraintId = "unknown";
    const empty = report();
    empty.checks[0].outputPointers = [];
    const invalid = report();
    invalid.checks[0].outputPointers = ["/briefCoverage/0/explanation"];
    const mismatch = report();
    mismatch.passed = false;
    const unexplained = report();
    unexplained.violations = ["制約に抵触"];
    for (const value of [omitted, duplicate, unknown, empty, invalid, mismatch, unexplained])
      expect(reconcileGenerationValidation(brief, candidate, value).passed).toBe(false);
    expect(isCharacterContentPointer(candidate, "")).toBe(false);
    expect(isCharacterContentPointer(candidate, "/schemaVersion")).toBe(false);
    expect(isCharacterContentPointer(candidate, "/personality/summary")).toBe(true);
  });
});
describe("scoped generation input", () => {
  it("shows conditions and exceptions separately from entry scope", () => {
    expect(
      snapshotConditionLabel({
        entryScope: "決戦",
        subjects: ["敵"],
        relationships: ["敵対"],
        narrativePhases: ["終盤"],
        conditions: ["対等な交渉"],
        exceptions: ["仲間には当てはまらない"],
      }),
    ).toBe("対象：決戦 ／ 人物：敵 ／ 関係：敵対 ／ 時期：終盤 ／ 条件：対等な交渉 ／ 例外：仲間には当てはまらない");
    expect(snapshotConditionLabel(null)).toBe("");
    expect(snapshotConditionLabel({ scope: "限定場面", ignored: true })).toBe("対象：限定場面");
    expect(snapshotConditionLabel({ subjects: [1, "相手"], conditions: null })).toBe("人物：相手");
  });
  it("preserves reaction and polarity and excludes prohibited stances from requirements", () => {
    const scope = { schemaVersion: "2", entryScope: "敵対時のみ", conditions: ["憧れの対象ではない"] };
    const selections = compileGenerationSelections(
      [
        {
          id: "a",
          item_type: "dimension",
          stable_key: "competence.intelligence",
          label: "知略",
          payload_json: JSON.stringify({
            responseChannel: "narrative_interest",
            condition: scope,
            positiveScore: 0.9,
            negativeScore: 0.3,
          }),
          treatment: "include",
        },
        ...(["required", "include", "explore", "prohibit"] as const).map((treatment) => ({
          id: treatment,
          item_type: "value_stance",
          stable_key: "value",
          label: "悪",
          payload_json: JSON.stringify({
            targetRef: "悪",
            targetType: "attribute",
            orientation: "evil",
            stance: treatment,
            scope,
          }),
          treatment,
        })),
      ],
      2,
    );
    expect(selections[0]).toMatchObject({
      responseChannel: "narrative_interest",
      condition: scope,
      polarity: { positive: 0.9, negative: 0.3 },
    });
    expect(selections[0].reactionDescription).toBeTruthy();
    expect(selectionValuePolicy(selections).requiredStances).toEqual([{ target: "悪", stance: "required", scope }]);
    expect(
      selectionValuePolicy(selections.filter((item) => item.treatment === "prohibit")).allowedOrientations,
    ).toEqual([]);
  });
  it("can include narrative interest and exclude admiration for the same attribute", () => {
    const groups = groupGenerationSnapshotItems(
      ["narrative_interest", "admiration"].map((responseChannel) => ({
        id: responseChannel,
        type: "dimension",
        stableKey: "same",
        label: "同じ属性",
        payload: { responseChannel },
      })),
    );
    expect(expandSnapshotTreatments(groups, { narrative_interest: "include" }, { admiration: "prohibit" })).toEqual({
      selectedItemIds: ["narrative_interest"],
      prohibitedItemIds: ["admiration"],
    });
  });
  it("normalizes exact copies and distinguishes unrelated texts", () => {
    expect(textOverlap("同じ人物の設定", "同じ人物の設定")).toBe(1);
    expect(textOverlap("ABC", "abc")).toBe(1);
    expect(textOverlap("", "")).toBe(0);
    expect(textOverlap("灯台守", "海流の音")).toBe(0);
  });
});
