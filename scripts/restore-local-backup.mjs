import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [, , backupArgument, targetArgument] = process.argv;
if (!backupArgument || !targetArgument)
  throw new Error("Usage: node scripts/restore-local-backup.mjs <backup.sql> <new-database.sqlite>");
const backupPath = resolve(backupArgument);
const targetPath = resolve(targetArgument);
if (existsSync(targetPath)) throw new Error(`Refusing to overwrite existing database: ${targetPath}`);

const database = new DatabaseSync(targetPath);
try {
  // Wrangler's D1 export is not guaranteed to order referenced tables before
  // rows that point to them. Load the complete snapshot first, then enforce
  // and verify every foreign key once all tables and rows exist.
  database.exec("PRAGMA foreign_keys=OFF");
  database.exec(readFileSync(backupPath, "utf8"));
  database.exec("PRAGMA foreign_keys=ON");
  const violations = database.prepare("PRAGMA foreign_key_check").all();
  if (violations.length) throw new Error(`Restored database has ${violations.length} foreign key violations`);
  const tables = database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table'").get();
  console.log(JSON.stringify({ restored: true, tables: Number(tables.count) }));
} finally {
  database.close();
}
