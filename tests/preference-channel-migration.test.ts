import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { testDatabase } from "./support/database";
import { fixtureTime, insertFixture, seedReview } from "./support/fixtures";

it("migrates populated normal/dark candidates without losing self links, evidence, indexes or constraints", () => {
  const db = testDatabase({ migrationCount: 3 });
  try {
    seedReview(db.database);
    db.database.exec(`INSERT INTO preference_assertions SELECT 'dark-preference',owner_user_id,analysis_run_id,
      entry_revision_id,character_identity_id,representation_id,attribute_definition_id,raw_mention_id,
      'dark',polarity,'dark_character_liking',strength,explicitness,confidence,context_json,status,NULL,created_at
      FROM preference_assertions WHERE id='preference';
      UPDATE preference_assertions SET status='superseded',superseded_by_id='dark-preference' WHERE id='preference'`);
    insertFixture(db.database, "evidence_fragments", {
      id: "proof",
      owner_user_id: "owner",
      owner_type: "preference_assertion",
      owner_id: "preference",
      evidence_origin: "user_input",
      support_type: "supports",
      excerpt_text: "確認した好み",
      user_input_path: "/preference/likedReasons",
      verification_status: "verified_quote",
      inference_type: "direct",
      confidence: 0.9,
      created_at: fixtureTime,
    });
    const before = db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all();
    const evidence = db.database.prepare("SELECT * FROM evidence_fragments").all();
    const indexes = db.database
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='preference_assertions' ORDER BY name",
      )
      .all();
    db.database.exec("BEGIN");
    db.database.exec(readFileSync("database/migrations/004_nullable_preference_channel.sql", "utf8"));
    db.database.exec("COMMIT");
    expect(db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all()).toEqual(before);
    expect(db.database.prepare("SELECT * FROM evidence_fragments").all()).toEqual(evidence);
    expect(
      db.database
        .prepare(
          "SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='preference_assertions' ORDER BY name",
        )
        .all(),
    ).toEqual(indexes);
    db.database.exec("UPDATE preference_assertions SET response_channel=NULL WHERE id='dark-preference'");
    expect(
      db.database.prepare("SELECT response_channel FROM preference_assertions WHERE id='dark-preference'").get()
        ?.response_channel,
    ).toBeNull();
    expect(() => db.database.exec("UPDATE preference_assertions SET response_channel='unknown'")).toThrow();
    expect(db.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.database.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table'").get()?.n).toBe(53);
  } finally {
    db.close();
  }
});
