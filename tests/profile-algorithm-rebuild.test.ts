import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCurrentProfileAlgorithm,
  loadProjectionFreshness,
  PROFILE_ALGORITHM_VERSION,
} from "../worker/services/profile";
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
}

function testDatabase(algorithmVersion = "profile/v1.1.0") {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE profile_projections (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, generation INTEGER NOT NULL,
      algorithm_version TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE projection_rebuild_states (
      owner_user_id TEXT PRIMARY KEY, desired_generation INTEGER NOT NULL,
      built_generation INTEGER NOT NULL, status TEXT NOT NULL, lease_owner TEXT,
      lease_expires_at TEXT, last_error_code TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, job_type TEXT NOT NULL,
      status TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      input_generation INTEGER NOT NULL, progress_current INTEGER NOT NULL,
      progress_total INTEGER NOT NULL, current_step TEXT, retryable INTEGER NOT NULL,
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      analysis_domain TEXT NOT NULL,
      UNIQUE (owner_user_id,job_type,target_type,target_id,input_generation)
    );
    CREATE TABLE outbox_events (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL, aggregate_revision INTEGER NOT NULL, event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
      correlation_id TEXT NOT NULL, deduplication_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL, available_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO profile_projections VALUES ('projection','owner',2,?,'current')").run(algorithmVersion);
  database
    .prepare(
      "INSERT INTO projection_rebuild_states VALUES ('owner',2,2,'current',NULL,NULL,NULL,'2026-01-01T00:00:00.000Z')",
    )
    .run();

  let batchQueue = Promise.resolve<unknown>(undefined);
  const d1 = {
    prepare(sql: string) {
      return new TestStatement(database, sql);
    },
    batch(statements: TestStatement[]) {
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
      const result = batchQueue.then(execute, execute);
      batchQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  } as unknown as D1Database;
  return { database, env: { DB: d1 } as unknown as Env };
}

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("profile algorithm rebuild scheduling", () => {
  it("does nothing when the current projection already uses the active algorithm", async () => {
    current = testDatabase(PROFILE_ALGORITHM_VERSION);

    await expect(ensureCurrentProfileAlgorithm(current.env, "owner")).resolves.toBeNull();
    await expect(loadProjectionFreshness(current.env, "owner")).resolves.toMatchObject({
      status: "fresh",
      desiredGeneration: 2,
      builtGeneration: 2,
    });
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toMatchObject({ count: 0 });
  });

  it("queues one newer generation and reports rebuilding for an old algorithm", async () => {
    current = testDatabase();

    const first = await ensureCurrentProfileAlgorithm(current.env, "owner");
    const repeated = await ensureCurrentProfileAlgorithm(current.env, "owner");

    expect(first).toMatchObject({ desiredGeneration: 3, builtGeneration: 2 });
    expect(repeated).toEqual(first);
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toMatchObject({ count: 1 });
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toMatchObject({ count: 1 });
    expect(
      current.database
        .prepare(
          "SELECT desired_generation,built_generation,status FROM projection_rebuild_states WHERE owner_user_id='owner'",
        )
        .get(),
    ).toMatchObject({ desired_generation: 3, built_generation: 2, status: "queued" });
    await expect(loadProjectionFreshness(current.env, "owner")).resolves.toMatchObject({
      status: "rebuilding",
      desiredGeneration: 3,
      builtGeneration: 2,
    });
  });

  it("converges concurrent detections on the same job and outbox event", async () => {
    current = testDatabase();

    const results = await Promise.all([
      ensureCurrentProfileAlgorithm(current.env, "owner"),
      ensureCurrentProfileAlgorithm(current.env, "owner"),
      ensureCurrentProfileAlgorithm(current.env, "owner"),
    ]);

    expect(new Set(results.map((result) => result?.jobId))).toHaveProperty("size", 1);
    expect(new Set(results.map((result) => result?.outboxEventId))).toHaveProperty("size", 1);
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toMatchObject({ count: 1 });
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toMatchObject({ count: 1 });
  });
});
