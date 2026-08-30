import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
const files = readdirSync("docs/詳細設計/database")
  .filter((file) => /^\d+.*\.sql$/u.test(file))
  .sort();
for (const file of files) database.exec(readFileSync(`docs/詳細設計/database/${file}`, "utf8"));

const expected = [
  "users",
  "user_character_entries",
  "character_understanding_snapshots",
  "preference_assertions",
  "value_stance_assertions",
  "profile_projections",
  "graph_projection_snapshots",
  "generated_characters",
  "jobs",
  "model_run_metadata",
];
const actual = new Set(
  database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map(({ name }) => name),
);
for (const table of expected) if (!actual.has(table)) throw new Error(`Missing table: ${table}`);
if (files.length !== 2) throw new Error(`Expected 2 baseline migrations, found ${files.length}`);
if (actual.size !== 46) throw new Error(`Expected 46 application tables, found ${actual.size}`);
const removedTables = [
  "consents",
  "platform_usage_counters",
  "idempotency_responses",
  "work_versions",
  "representation_relations",
  "attribute_aliases",
  "attribute_relations",
  "source_documents",
  "source_document_revisions",
  "source_fragments",
  "source_set_versions",
  "entry_assets",
  "preference_value_stance_links",
  "assertion_reviews",
  "user_correction_events",
  "profile_patterns",
  "generated_character_revisions",
  "similarity_check_results",
  "feedback_events",
  "feedback_attribute_ratings",
  "audit_events",
];
for (const table of removedTables) if (actual.has(table)) throw new Error(`Removed table remains: ${table}`);
const removedColumns = {
  credentials: ["key_generation", "status", "rotated_at", "revoked_at"],
  sessions: ["credential_generation"],
  user_character_entries: ["draft_schema_version", "draft_payload_json", "deleted_at"],
  evidence_fragments: ["source_fragment_id", "provenance_schema_version"],
};
for (const [table, columns] of Object.entries(removedColumns)) {
  const tableColumns = new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name }) => name),
  );
  for (const column of columns)
    if (tableColumns.has(column)) throw new Error(`Removed column remains: ${table}.${column}`);
}
const evidenceDdl = database
  .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='evidence_fragments'")
  .get().sql;
if (evidenceDdl.includes("legacy_unverified")) throw new Error("Removed evidence status remains");
const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyErrors.length) throw new Error(`Foreign key errors: ${JSON.stringify(foreignKeyErrors)}`);
const ontologyCount = database.prepare("SELECT COUNT(*) count FROM attribute_definitions").get().count;
if (ontologyCount < 80) throw new Error(`Ontology is unexpectedly small: ${ontologyCount}`);
console.log(`DDL OK: ${files.length} migrations, ${actual.size} tables, ${ontologyCount} attributes`);
