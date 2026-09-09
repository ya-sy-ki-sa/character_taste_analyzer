import { describe, expect, it } from "vitest";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { selectExportUnderstandingSnapshots } from "../worker/features/account/repositories/exports";
import { loadEntryReview } from "../worker/features/entries/review";
import { mutateUnderstandingReview } from "../worker/features/entries/understanding-review";
import { UNDERSTANDING_INFORMATION_POLICY } from "../worker/llm/prompts/understanding";
import explicitFixtures from "./fixtures/explicit-preferences.json";
import sparseFixtures from "./fixtures/sparse-understanding.json";
import { rebuild, setup } from "./support/preference-pipeline";
import { frozenAudit } from "./support/understanding-audit";

describe("understanding information quality storage and continuation", () => {
  it("preserves sparse quality through confirmation, export and profile without losing explicit preferences", async () => {
    const t = await setup("standard", { ...explicitFixtures[0], understanding: frozenAudit(sparseFixtures[0]) });
    const quality = t.detail.understanding?.informationQuality;
    expect(quality).toMatchObject({
      assessedAt: "analysis",
      status: "limited",
      completionAttempted: true,
      contentAspectCount: 1,
      concreteAspectCount: 0,
    });
    const exported = await selectExportUnderstandingSnapshots(t.db.DB, t.owner).all<{
      source_assessment_json: string;
    }>();
    expect(JSON.parse(exported.results[0].source_assessment_json).informationQuality).toEqual(quality);
    expect(
      t.requests.filter((request) =>
        ["customization_delta", "character_understanding", "understanding_audit"].includes(request.operation),
      ),
    ).toHaveLength(4);
    const auditSystem = t.requests.find((request) => request.operation === "understanding_audit")?.messages[0].content;
    expect(auditSystem).toContain("aspectAssessments");
    expect(auditSystem).not.toMatch(/userExplicitSummary|responseChannel/u);
    const preferenceCalls = t.requests.filter((request) => request.operation.startsWith("preference_"));
    expect(preferenceCalls).toHaveLength(2);
    expect(preferenceCalls.every((request) => !JSON.stringify(request.messages).includes('"informationQuality"'))).toBe(
      true,
    );
    expect(t.analysis.assertions).toHaveLength(explicitFixtures[0].expectedAssertions.length);
    expect(t.analysis.assertions.every((item) => item.evidence.length > 0)).toBe(true);
    expect((await rebuild(t, "standard"))?.dimensions.length).toBeGreaterThan(0);
    const metadata = t.db.database
      .prepare(
        "SELECT prompt_version,schema_version,effective_settings_json FROM model_run_metadata WHERE operation='understanding_audit'",
      )
      .all();
    expect(metadata).toHaveLength(2);
    for (const row of metadata) {
      expect(row.prompt_version).toContain(UNDERSTANDING_INFORMATION_POLICY);
      expect(row.schema_version).toBe("1.1");
    }
  });

  it("keeps the analysis-time assessment after a manual understanding edit", async () => {
    let initialQuality: unknown;
    const t = await setup(
      "standard",
      { ...explicitFixtures[0], understanding: frozenAudit(sparseFixtures[0]) },
      true,
      async (env, owner, snapshotId) => {
        await mutateUnderstandingReview(
          env,
          owner,
          "standard",
          snapshotId,
          {
            action: "add_assertion",
            attributeStableKey: null,
            rawLabel: "仲間との関係",
            valueText: "幼馴染とは互いに困りごとを相談する",
          },
          crypto.randomUUID(),
        );
        const row = await env.DB.prepare(
          "SELECT source_assessment_json FROM character_understanding_snapshots WHERE id=?",
        )
          .bind(snapshotId)
          .first<{ source_assessment_json: string }>();
        initialQuality = JSON.parse(row?.source_assessment_json ?? "{}").informationQuality;
      },
    );
    expect(initialQuality).toMatchObject({ status: "limited", completionAttempted: true });
    expect(t.detail.understanding?.informationQuality).toEqual(initialQuality);
    expect(
      t.detail.understanding?.assertions.some((item) => item.value_text === "幼馴染とは互いに困りごとを相談する"),
    ).toBe(true);
  });

  it("leaves older snapshots unassessed instead of treating them as sufficient", async () => {
    const t = await setup("standard");
    t.db.database
      .prepare(
        "UPDATE character_understanding_snapshots SET source_assessment_json=json_remove(source_assessment_json,'$.informationQuality') WHERE owner_user_id=?",
      )
      .run(t.owner);
    const detail = reviewDetailSchema.parse(await loadEntryReview(t.env, t.owner, "standard", t.params.entryId));
    expect(detail.understanding?.informationQuality).toBeUndefined();
  });

  it("does not add standard audit requirements to dark analysis", async () => {
    const t = await setup("dark");
    expect(t.detail.understanding?.informationQuality).toBeUndefined();
    expect(t.requests.filter((request) => request.operation === "dark_understanding_audit")).toHaveLength(1);
    expect(t.requests.some((request) => request.operation === "understanding_audit")).toBe(false);
    for (const request of t.requests) {
      expect(request.messages[0].content).not.toMatch(/aspectAssessments|wishful_identification|通常版の反応経路/u);
    }
  });
});
