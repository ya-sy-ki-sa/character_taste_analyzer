import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { buildCharacterMarkdown } from "../src/lib/entry-markdown";
import { loadEntryReview } from "../worker/features/entries/review";
import fixtures from "./fixtures/legacy-understanding-confidence.json";
import { testDatabase } from "./support/database";
import { fixtureTime, insertFixture, seedReview, seedUser } from "./support/fixtures";

describe("retiring whole-understanding confidence", () => {
  it.each(fixtures)("preserves $caseId as legacy only, keeping data and references", async (fixture) => {
    const db = testDatabase({ migrationCount: 4 });
    try {
      seedReview(db.database);
      db.database.exec(`UPDATE entry_revisions SET registration_payload_json=json_set(registration_payload_json,'$.preference',json('{"responseChannels":[]}'));
        UPDATE analysis_runs SET summary_json='{"userExplicitSummary":[],"inferredSummary":[],"limitations":[]}'`);
      seedUser(db.database, "other");
      db.database
        .prepare(
          "UPDATE character_understanding_snapshots SET overall_confidence=?,summary_json=?,source_assessment_json=?,uncertainties_json=?",
        )
        .run(
          fixture.legacyOverallConfidence,
          JSON.stringify(fixture.summary),
          JSON.stringify(fixture.sourceAssessment),
          JSON.stringify(fixture.uncertainties),
        );
      const original = db.database.prepare("SELECT * FROM character_understanding_snapshots").get();
      if (!original) throw new Error("missing snapshot");
      insertFixture(db.database, "character_understanding_snapshots", {
        ...original,
        id: "base",
        snapshot_generation: 2,
        overall_confidence: 0.75,
      });
      db.database.exec("UPDATE character_understanding_snapshots SET base_snapshot_id='base' WHERE id='understanding'");
      insertFixture(db.database, "character_assertions", {
        id: "attribute",
        owner_user_id: "owner",
        snapshot_id: "understanding",
        raw_label: "人物の同定",
        value_text: "同定用の属性",
        assertion_kind: "setting",
        explicitness: "source_explicit",
        confidence: 0.98,
        status: "confirmed",
        created_at: fixtureTime,
      });
      insertFixture(db.database, "evidence_fragments", {
        id: "proof",
        owner_user_id: "owner",
        owner_type: "character_assertion",
        owner_id: "attribute",
        evidence_origin: "user_input",
        support_type: "supports",
        excerpt_text: "名前",
        user_input_path: "/characterName",
        verification_status: "verified_quote",
        inference_type: "direct",
        confidence: 0.98,
        created_at: fixtureTime,
      });
      const snapshots = db.database.prepare("SELECT * FROM character_understanding_snapshots ORDER BY id").all();
      const assertions = db.database.prepare("SELECT * FROM character_assertions").all();
      const evidence = db.database.prepare("SELECT * FROM evidence_fragments").all();
      const indexes = db.database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' ORDER BY name").all();
      db.database.exec("BEGIN");
      db.database.exec(readFileSync("database/migrations/005_retire_overall_confidence.sql", "utf8"));
      db.database.exec("COMMIT");
      expect(db.database.prepare("SELECT * FROM character_understanding_snapshots ORDER BY id").all()).toEqual(
        snapshots.map(({ overall_confidence, ...rest }) => ({
          ...rest,
          legacy_overall_confidence: overall_confidence,
        })),
      );
      expect(db.database.prepare("SELECT * FROM character_assertions").all()).toEqual(assertions);
      expect(db.database.prepare("SELECT * FROM evidence_fragments").all()).toEqual(evidence);
      expect(db.database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' ORDER BY name").all()).toEqual(
        indexes,
      );
      expect(db.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() =>
        db.database.exec("UPDATE character_understanding_snapshots SET legacy_overall_confidence=1.1"),
      ).toThrow();
      expect(await loadEntryReview(db.env, "other", "standard", "entry")).toBeNull();
      // Put the target after the base for the existing latest-created selection.
      db.database.exec("UPDATE character_understanding_snapshots SET created_at='2026-09-06' WHERE id='understanding'");
      const raw = await loadEntryReview(db.env, "owner", "standard", "entry");
      expect(raw?.understanding).not.toHaveProperty("confidence");
      expect(raw?.baseUnderstanding).not.toHaveProperty("confidence");
      const detail = reviewDetailSchema.parse(raw);
      expect(detail.understanding?.informationQuality).toBeUndefined();
      expect(detail.understanding?.assertions[0].confidence).toBe(0.98);
      expect(detail.understanding?.evidenceSummary.counts.userInputQuote).toBe(1);
      expect(detail.baseUnderstanding?.evidenceSummary.assertionCount).toBe(0);
      const markdown = buildCharacterMarkdown(detail);
      expect(markdown).not.toContain("全体登録内支持度");
      expect(markdown).toContain("情報量は未評価");
      expect(markdown).toContain("登録内支持度: 98%");
      const { overall_confidence: _legacy, ...newSnapshot } = original;
      insertFixture(db.database, "character_understanding_snapshots", {
        ...newSnapshot,
        id: "new",
        snapshot_generation: 3,
      });
      expect(
        db.database
          .prepare("SELECT legacy_overall_confidence FROM character_understanding_snapshots WHERE id='new'")
          .get()?.legacy_overall_confidence,
      ).toBeNull();
    } finally {
      db.close();
    }
  });
});
