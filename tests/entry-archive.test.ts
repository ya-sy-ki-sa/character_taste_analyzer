import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createD1DataStoreStrategy } from "../worker/storage/d1-strategy";
import type { Env } from "../worker/types";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new TestStatement(this.database, this.sql, values as SqlValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async all<T>() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values) as T[],
      meta: { changes: 0 },
    };
  }
}

function testDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE user_character_entries (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, analysis_domain TEXT NOT NULL,
      registration_type TEXT NOT NULL, status TEXT NOT NULL, active_revision_number INTEGER NOT NULL,
      archived_at TEXT, updated_at TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE entry_revisions (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
      representation_id TEXT NOT NULL, registration_payload_json TEXT NOT NULL
    );
    CREATE TABLE character_understanding_snapshots (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, representation_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_runs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, entry_revision_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE projection_rebuild_states (
      owner_user_id TEXT PRIMARY KEY, desired_generation INTEGER NOT NULL,
      built_generation INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, job_type TEXT NOT NULL, status TEXT NOT NULL,
      target_type TEXT NOT NULL, target_id TEXT NOT NULL, input_generation INTEGER NOT NULL,
      progress_current INTEGER NOT NULL, progress_total INTEGER NOT NULL, current_step TEXT NOT NULL,
      retryable INTEGER NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, analysis_domain TEXT, error_code TEXT, error_detail_safe TEXT
    );
    CREATE TABLE outbox_events (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL, aggregate_revision INTEGER NOT NULL, event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
      correlation_id TEXT NOT NULL, deduplication_key TEXT NOT NULL, status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL, available_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO user_character_entries VALUES
      ('failed-entry','owner','standard','existing','failed',1,NULL,'2026-01-01T00:00:00.000Z',1);
    INSERT INTO entry_revisions VALUES
      ('failed-revision','failed-entry',1,'failed-representation',
       '{"registrationType":"existing","workTitle":"失敗作品","characterName":"解析失敗キャラ"}');
  `);
  const d1 = {
    prepare(sql: string) {
      return new TestStatement(database, sql);
    },
    async batch(statements: TestStatement[]) {
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
    },
  } as unknown as D1Database;
  return { database, env: { DB: d1 } as unknown as Env };
}

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("character entry archive", () => {
  it("archives an entry whose analysis failed", async () => {
    current = testDatabase();

    await expect(
      createD1DataStoreStrategy(current.env).archiveEntry("owner", "standard", "failed-entry"),
    ).resolves.toMatchObject({ outboxEventId: expect.any(String) });

    expect(current.database.prepare("SELECT status,archived_at FROM user_character_entries").get()).toMatchObject({
      status: "archived",
      archived_at: expect.any(String),
    });
  });

  it("does not return archived entries in the registration list", async () => {
    current = testDatabase();
    current.database.exec(`
      INSERT INTO user_character_entries VALUES
        ('archived-entry','owner','standard','existing','archived',1,'2026-01-02T00:00:00.000Z','2026-01-02T00:00:00.000Z',2);
      INSERT INTO entry_revisions VALUES
        ('archived-revision','archived-entry',1,'archived-representation',
         '{"registrationType":"existing","workTitle":"除外作品","characterName":"除外済みキャラ"}');
    `);

    const entries = await createD1DataStoreStrategy(current.env).listEntries("owner", "standard");

    expect(entries.map((entry) => entry.id)).toEqual(["failed-entry"]);
  });
});
