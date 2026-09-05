import { describe, expect, it, vi } from "vitest";
import { accountExportDocumentSchema } from "../shared/contracts/account-response";
import { anyEntryDraftSchema } from "../shared/contracts/entries";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { buildCharacterMarkdown } from "../src/lib/entry-markdown";
import { createAccountExport, processAccountExport } from "../worker/features/account/exports";
import { exportUnderstandingEvidence } from "../worker/features/account/understanding-evidence";
import { processCharacterAnalysis } from "../worker/features/analysis/understanding";
import { createEntry } from "../worker/features/entries/create";
import { loadEntryReview } from "../worker/features/entries/review";
import { mutateUnderstandingReview } from "../worker/features/entries/understanding-review";
import explicitFixtures from "./fixtures/explicit-preferences.json";
import sparseFixtures from "./fixtures/sparse-understanding.json";
import { setup } from "./support/preference-pipeline";
import { frozenAudit } from "./support/understanding-audit";

describe.each(["standard", "dark"] as const)("understanding evidence transport (%s)", (domain) => {
  it("refreshes evidence counts after add/update/delete while retaining the original assessment and supports", async () => {
    const t = await setup(domain, undefined, true, async (env, owner, snapshotId) => {
      const row = await env.DB.prepare("SELECT entry_id FROM entry_revisions LIMIT 1").first<{ entry_id: string }>();
      if (!row) throw new Error("missing entry");
      const read = async () => {
        const detail = await loadEntryReview(env, owner, domain, row.entry_id);
        if (!detail?.understanding) throw new Error("missing understanding");
        return detail.understanding;
      };
      const initial = await read();
      const mutate = async (input: Parameters<typeof mutateUnderstandingReview>[4]) =>
        mutateUnderstandingReview(env, owner, domain, snapshotId, input, crypto.randomUUID());
      const added = await mutate({
        action: "add_assertion",
        rawLabel: "他者との関係",
        valueText: "幼馴染には悩みを打ち明ける",
        attributeStableKey: null,
      });
      const afterAdd = await read();
      expect(afterAdd.evidenceSummary.assertionCount).toBe(initial.evidenceSummary.assertionCount + 1);
      expect(afterAdd.evidenceSummary.counts.userConfirmation).toBe(
        initial.evidenceSummary.counts.userConfirmation + 1,
      );
      const updated = await mutate({
        action: "update_assertion",
        targetId: added.changedId,
        rawLabel: "他者との関係",
        valueText: "幼馴染と互いに悩みを打ち明ける",
        attributeStableKey: null,
      });
      const afterUpdate = await read();
      expect(afterUpdate.evidenceSummary).toEqual(afterAdd.evidenceSummary);
      expect(afterUpdate.assertions.some((item) => item.id === added.changedId)).toBe(false);
      await mutate({ action: "delete_assertion", targetId: updated.changedId });
      const afterDelete = await read();
      expect(afterDelete.evidenceSummary).toEqual(initial.evidenceSummary);
      expect(afterDelete.assertions).toEqual(initial.assertions);
      for (const snapshot of [afterAdd, afterUpdate, afterDelete]) {
        expect(snapshot.informationQuality).toEqual(initial.informationQuality);
        expect(snapshot).not.toHaveProperty("confidence");
      }
    });
    expect(t.analysis.assertions.map((item) => item.confidence)).toEqual(
      explicitFixtures[0].expectedAssertions.map(() => 0.92),
    );
    expect(
      t.db.database
        .prepare("SELECT legacy_overall_confidence FROM character_understanding_snapshots")
        .all()
        .every((row) => row.legacy_overall_confidence === null),
    ).toBe(true);
  });

  it("keeps customized base and target counts separate in review and export", async () => {
    const t = await setup(domain);
    const draft = anyEntryDraftSchema.parse({
      registrationType: "customized_existing",
      workTitle: "固定応答の作品",
      baseCharacterName: "基本人物",
      characterName: "別設定の人物",
      mediaType: "小説",
      representationType: "alternate_setting",
      identityResolution: { mode: "new" },
      referenceMaterial: "冷酷な策略家として敵対する。",
      customizationDescription: "策略で仲間を支える人物として描く。",
      preference: { likedReasons: "策略を使うところが好き。", responseChannels: [] },
      ...(domain === "dark" ? { darkContext: { focusDescription: "敵対する状態" } } : {}),
    });
    const created = await createEntry(t.env, t.owner, domain, draft, crypto.randomUUID());
    await processCharacterAnalysis(t.env, { ...t.params, jobId: created.jobId, entryId: created.entryId });
    const read = async () => reviewDetailSchema.parse(await loadEntryReview(t.env, t.owner, domain, created.entryId));
    const before = await read();
    if (!before.understanding) throw new Error("missing customized target");
    if (domain === "standard") expect(before.baseUnderstanding).not.toBeNull();
    else {
      expect(before.baseUnderstanding).toBeNull();
      expect(before.darkBaseline).not.toBeNull();
    }
    if (before.baseUnderstanding) expect(before.baseUnderstanding).not.toHaveProperty("confidence");
    expect(before.understanding).not.toHaveProperty("confidence");
    await mutateUnderstandingReview(
      t.env,
      t.owner,
      domain,
      before.understanding.id,
      { action: "add_assertion", rawLabel: "協力", valueText: "仲間に計画を説明する", attributeStableKey: null },
      crypto.randomUUID(),
    );
    const after = await read();
    expect(after.baseUnderstanding).toEqual(before.baseUnderstanding);
    expect(after.darkBaseline).toEqual(before.darkBaseline);
    expect(after.understanding?.evidenceSummary.assertionCount).toBe(
      before.understanding.evidenceSummary.assertionCount + 1,
    );
    expect(after.understanding?.evidenceSummary.counts.userConfirmation).toBe(1);
    const exported = exportUnderstandingEvidence(
      t.db.database.prepare("SELECT * FROM character_understanding_snapshots WHERE owner_user_id=?").all(t.owner),
      t.db.database.prepare("SELECT * FROM character_assertions WHERE owner_user_id=?").all(t.owner),
      t.db.database.prepare("SELECT * FROM evidence_fragments WHERE owner_user_id=?").all(t.owner),
    );
    for (const snapshot of [after.baseUnderstanding, after.understanding]) {
      if (!snapshot) continue;
      expect(exported.find((item) => item.snapshotId === snapshot?.id)?.evidenceSummary).toEqual(
        snapshot?.evidenceSummary,
      );
    }
  });

  it("exports 5.0 evidence counts and legacy values, upgrades queued metadata, and leaves ready 4.0 untouched", async () => {
    const t = await setup(domain);
    const understanding = t.detail.understanding;
    if (!understanding) throw new Error("missing understanding");
    const objects = new Map<string, Uint8Array>();
    t.env.EXPORTS = {
      put: vi.fn(async (key: string, value: Uint8Array) => {
        objects.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    } as unknown as R2Bucket;
    t.db.database
      .prepare("UPDATE character_understanding_snapshots SET legacy_overall_confidence=0.98 WHERE id=?")
      .run(understanding.id);
    const old = await createAccountExport(t.env, t.owner, crypto.randomUUID());
    t.db.database
      .prepare("UPDATE account_exports SET status='ready',schema_version='4.0',object_key='old.json' WHERE id=?")
      .run(old.exportId);
    t.db.database.prepare("UPDATE jobs SET status='succeeded' WHERE id=?").run(old.jobId);
    objects.set("old.json", new TextEncoder().encode('{"schemaVersion":"4.0"}'));
    const created = await createAccountExport(t.env, t.owner, crypto.randomUUID());
    t.db.database.prepare("UPDATE account_exports SET schema_version='4.0' WHERE id=?").run(created.exportId);
    await processAccountExport(t.env, { ...created, ownerUserId: t.owner });
    const status = t.db.database
      .prepare("SELECT status,schema_version FROM account_exports WHERE id=?")
      .get(created.exportId);
    expect(status).toEqual({ status: "ready", schema_version: "5.0" });
    const serialized = new TextDecoder().decode(objects.get(`account-exports/${created.exportId}.json`));
    const document = accountExportDocumentSchema.parse(JSON.parse(serialized));
    expect(document.schemaVersion).toBe("5.0");
    expect(document.understanding.evidenceSummaries).toEqual([
      { snapshotId: understanding.id, evidenceSummary: understanding.evidenceSummary },
    ]);
    const snapshot = document.understanding.snapshots[0];
    expect(snapshot.legacy_overall_confidence).toBe(0.98);
    expect(snapshot).not.toHaveProperty("overall_confidence");
    expect(JSON.parse(String(snapshot.source_assessment_json)).informationQuality).toEqual(
      understanding.informationQuality,
    );
    await processAccountExport(t.env, { ...old, ownerUserId: t.owner });
    expect(
      t.db.database.prepare("SELECT schema_version FROM account_exports WHERE id=?").get(old.exportId)?.schema_version,
    ).toBe("4.0");
    expect(new TextDecoder().decode(objects.get("old.json"))).toBe('{"schemaVersion":"4.0"}');
    expect(t.env.EXPORTS.put).toHaveBeenCalledTimes(1);
  });
});

it.each(sparseFixtures)("exports S02 $caseId information as counts/reasons without a whole score", async (fixture) => {
  const t = await setup("standard", { ...explicitFixtures[0], understanding: frozenAudit(fixture) });
  const detail = reviewDetailSchema.parse(t.detail);
  const quality = detail.understanding?.informationQuality;
  if (!quality) throw new Error("missing quality");
  const markdown = buildCharacterMarkdown(detail);
  expect(markdown).toContain(`具体的描写のある項目 ${quality.concreteAspectCount}/7`);
  expect(markdown).not.toContain("全体登録内支持度");
  expect(t.detail.understanding).not.toHaveProperty("confidence");
  if (quality.status === "limited") {
    expect(markdown).toContain("解析時点では人物像の情報が限られています");
    for (const reason of quality.reasons) expect(markdown).toContain(reason);
  } else expect(markdown).toContain("今回の不足基準には該当しません");
});
