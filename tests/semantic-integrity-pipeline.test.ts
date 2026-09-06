import { describe, expect, it } from "vitest";
import { selectExportAnalysisRuns } from "../worker/features/account/repositories/exports";
import { loadCurrentGraph } from "../worker/features/profile/graph";
import { context, type Fixture, rebuild, setup } from "./support/preference-pipeline";

const scopes = [
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
    id: "C12-reversed",
    input: "妻子がいるロイがヒューズに遠慮なく接する設定が好き。",
    label: "妻子がいるロイからヒューズへの接し方",
    actor: "ロイ",
    target: "ヒューズ",
    possessor: "ロイ",
    negative: null,
    polarity: "positive",
  },
  {
    id: "A13",
    input: "日向と影山の連携が好きだが、二人を恋愛としては読まない。",
    label: "日向と影山の連携",
    actor: "日向",
    target: "影山",
    possessor: null,
    negative: "二人の関係を恋愛と読む",
    polarity: "positive",
  },
  {
    id: "C14",
    input: "タイガーがバーナビーに認められるところが好き。",
    label: "タイガー本人が認められる",
    actor: "バーナビー",
    target: "タイガー",
    possessor: null,
    negative: null,
    polarity: "positive",
  },
  {
    id: "pronoun",
    input: "ヒューズがロイを見て笑う。彼に肩書きより本人を見てもらえるところが好き。",
    label: "ヒューズからロイ本人への接し方",
    actor: "ヒューズ",
    target: "ロイ",
    possessor: null,
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
