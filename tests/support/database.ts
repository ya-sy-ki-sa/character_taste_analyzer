import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Env } from "../../worker/types";

const migrations = readdirSync("database/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`database/migrations/${name}`, "utf8"));

export function testDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const sql of migrations) database.exec(sql);
  class Statement {
    constructor(
      private sql: string,
      private values: SQLInputValue[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Statement(this.sql, values.map((value) => value ?? null) as SQLInputValue[]);
    }
    private prepared() {
      const placeholderCount = (this.sql.replace(/'[^']*(?:''[^']*)*'/gu, "").match(/\?/gu) ?? []).length;
      if (placeholderCount !== this.values.length)
        throw new Error(
          `D1 binding count mismatch: expected ${placeholderCount}, received ${this.values.length}: ${this.sql.slice(0, 100)}`,
        );
      return database.prepare(this.sql);
    }
    async first<T>() {
      return (this.prepared().get(...this.values) as T | undefined) ?? null;
    }
    async all<T>() {
      return { success: true, results: this.prepared().all(...this.values) as T[], meta: { changes: 0 } };
    }
    async run() {
      return { success: true, meta: { changes: Number(this.prepared().run(...this.values).changes) } };
    }
  }
  let queue = Promise.resolve<unknown>(undefined);
  const DB = {
    prepare: (sql: string) => new Statement(sql),
    batch(statements: Statement[]) {
      const execute = async () => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      };
      const pending = queue.then(execute, execute);
      queue = pending.catch(() => undefined);
      return pending;
    },
  } as unknown as D1Database;
  return { database, DB, env: { DB } as Env, close: () => database.close() };
}
