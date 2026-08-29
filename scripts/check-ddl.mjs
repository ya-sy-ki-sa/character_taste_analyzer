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
const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyErrors.length) throw new Error(`Foreign key errors: ${JSON.stringify(foreignKeyErrors)}`);
const ontologyCount = database.prepare("SELECT COUNT(*) count FROM attribute_definitions").get().count;
if (ontologyCount < 80) throw new Error(`Ontology is unexpectedly small: ${ontologyCount}`);
console.log(`DDL OK: ${files.length} migrations, ${actual.size} tables, ${ontologyCount} attributes`);
