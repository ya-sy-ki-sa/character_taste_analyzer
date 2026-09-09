import { describe, expect, it } from "vitest";
import { selectExportAnalysisRuns } from "../worker/features/account/repositories/exports";
import { loadCurrentGraph } from "../worker/features/profile/graph";
import { context, type Fixture, rebuild, setup } from "./support/preference-pipeline";

// Cover named roles/ownership, nullable roles, and positive/negative polarity once each.
const scopes: Array<{
  id: string;
  input: string;
  label: string;
  actor: string | null;
  target: string | null;
  possessor: string | null;
  negative: string | null;
  polarity: string;
}> = [
  {
    id: "C12",
    input: "妻子がいるヒューズがロイに遠慮なく接するところが好き。",
    label: "妻子がいるヒューズからロイへの接し方",
    actor: "ヒューズ",
    target: "ロイ",
    possessor: "ヒューズ",
    negative: null,
    polarity: "positive",
  },
  {
    id: "negated-state",
    input: "改心しないところが好き。",
    label: "改心しない状態",
    actor: null,
    target: null,
    possessor: null,
    negative: "改心する",
    polarity: "positive",
  },
  {
    id: "C11",
    input: "二人を支配する側とされる側に固定する解釈は苦手。",
    label: "支配と服従に固定する解釈",
    actor: null,
    target: null,
    possessor: null,
    negative: "支配と服従に固定する解釈を好む",
    polarity: "negative",
  },
];
function fixture(row: (typeof scopes)[number]): Fixture {
  return {
    caseId: row.id,
    preference: { likedReasons: row.input, responseChannels: [] },
    expectedAssertions: [
      {
        rawLabel: row.label,
        quote: row.input,
        responseChannel: null,
        conditions: [],
        polarity: row.polarity,
        context: {
          ...context,
          subjects: [row.actor, row.target].filter(Boolean),
          relationships: [`${row.actor ?? "人物"}から${row.target ?? "相手"}`],
          conditions: row.possessor ? [`妻子は${row.possessor}に属する`] : [],
          exceptions: row.negative ? [row.negative] : [],
        },
      },
    ],
    auditOverride(value) {
      value.preferenceAssertions[0].scopeAssessment = {
        ...value.preferenceAssertions[0].scopeAssessment,
        actor: row.actor,
        target: row.target,
        possessor: row.possessor,
        negatedProposition: row.negative,
        evaluatedProposition: row.label,
      };
      return value;
    },
  };
}
describe("scripted proposition audits through persistence and aggregation", () => {
  it.each(scopes)("preserves $id subject, ownership and negation without extra calls", async (row) => {
    const t = await setup("standard", fixture(row));
    expect(t.analysis.assertions[0]).toMatchObject({
      raw_label: row.label,
      polarity: row.polarity,
      response_channel: null,
    });
    const quality = t.analysis.qualityContext as { semanticAudit: { assertions: Array<{ scope: unknown }> } };
    expect(quality.semanticAudit.assertions[0].scope).toMatchObject({
      actor: row.actor,
      target: row.target,
      possessor: row.possessor,
      negatedProposition: row.negative,
    });
    const exported = await selectExportAnalysisRuns(t.db.DB, t.owner).all<{ quality_context_json: string }>();
    expect(JSON.parse(exported.results[0].quality_context_json).semanticAudit).toEqual(quality.semanticAudit);
    const profile = await rebuild(t, "standard");
    expect(profile?.dimensions).toHaveLength(1);
    expect(profile?.dimensions[0].condition).toEqual(t.analysis.assertions[0].context);
    expect(await loadCurrentGraph(t.env, t.owner, "standard")).not.toBeNull();
    expect(t.requests.filter((call) => call.operation.startsWith("preference_"))).toHaveLength(2);
    expect(
      t.requests
        .filter((call) => call.operation.startsWith("preference_"))
        .every((call) => !JSON.stringify(call.messages).includes('"semanticAudit"')),
    ).toBe(true);
  });
  it("persists jointly supporting quotes and aggregates the accepted preference", async () => {
    const item = fixture({
      ...scopes[1],
      id: "joint-evidence",
      input: "銀髪が好き。ただし冷淡な人物に限る。",
      label: "銀髪",
      negative: null,
    });
    item.expectedAssertions[0].context = { ...context, conditions: ["冷淡な人物に限る"] };
    item.auditOverride = (value) => {
      const assertion = value.preferenceAssertions[0];
      const ref = assertion.evidence[0];
      assertion.evidence = ["銀髪が好き。", "ただし冷淡な人物に限る。"].map((quote) => ({
        ...ref,
        quote,
        supportAssessment: { verdict: "partial", reason: "対象または条件を支持" },
      }));
      assertion.evidenceSetAssessment = {
        verdict: "supported",
        reason: "対象と条件を合わせて支持",
        evidenceIndexes: [0, 1],
      };
      return value;
    };
    const t = await setup("standard", item);
    expect(t.analysis.assertions).toHaveLength(1);
    const quality = t.analysis.qualityContext as {
      semanticAudit: { assertions: Array<{ evidenceSetAssessment: unknown; evidence: Array<{ accepted: boolean }> }> };
    };
    const audit = quality.semanticAudit.assertions[0];
    expect(audit.evidenceSetAssessment).toMatchObject({ verdict: "supported", evidenceIndexes: [0, 1] });
    expect(audit.evidence.map((ref) => ref.accepted)).toEqual([true, true]);
    const profile = await rebuild(t, "standard");
    expect(profile?.dimensions).toHaveLength(1);
    expect(profile?.dimensions[0].condition.conditions).toEqual(["冷淡な人物に限る"]);
  });
  it.each(["mismatch", "uncertain"] as const)(
    "excludes a %s candidate while retaining explicit input and questions",
    async (verdict) => {
      const item = fixture(scopes[0]);
      item.auditOverride = (value) => {
        value.preferenceAssertions[0].scopeAssessment.verdict = verdict;
        return value;
      };
      const t = await setup("standard", item);
      expect(t.analysis.assertions).toEqual([]);
      expect(t.analysis.summary.userExplicitSummary).toContain(item.preference.likedReasons);
      expect(t.analysis.uncertainties.length).toBeGreaterThan(0);
      expect((await rebuild(t, "standard"))?.dimensions).toEqual([]);
    },
  );
  it("does not turn '好きとは限らない' into an adopted dislike", async () => {
    const item = fixture({
      ...scopes[0],
      input: "ヒューズの冗談が好きとは限らない。",
      label: "冗談への嫌悪",
      polarity: "negative",
    });
    item.auditOverride = (value) => {
      value.preferenceAssertions[0].evidence[0].supportAssessment = {
        verdict: "unsupported",
        reason: "嫌悪は明示されていない",
      };
      return value;
    };
    const t = await setup("standard", item);
    expect(t.analysis.assertions).toEqual([]);
    expect((await rebuild(t, "standard"))?.dimensions).toEqual([]);
  });
});
