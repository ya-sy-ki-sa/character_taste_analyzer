import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { claimJob, finishJobAttempt } from "../worker/services/jobs";
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

function testDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE user_character_entries (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, active_revision_number INTEGER NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, status TEXT NOT NULL,
      input_generation INTEGER NOT NULL, job_type TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, retryable INTEGER NOT NULL DEFAULT 1, current_step TEXT,
      error_code TEXT,error_detail_safe TEXT,updated_at TEXT,completed_at TEXT,revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE job_attempts (
      id TEXT PRIMARY KEY,job_id TEXT NOT NULL,attempt_number INTEGER NOT NULL,status TEXT NOT NULL,
      lease_owner TEXT,lease_expires_at TEXT,checkpoint_json TEXT,step_name TEXT,started_at TEXT,
      finished_at TEXT,error_code TEXT,error_detail_safe TEXT,UNIQUE(job_id,attempt_number)
    );
  `);
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

function seedJob(database: DatabaseSync, status = "queued", generation = 1) {
  database.prepare("INSERT INTO user_character_entries VALUES ('entry','owner',?)").run(generation);
  database
    .prepare(
      `INSERT INTO jobs
        (id,owner_user_id,status,input_generation,job_type,target_type,target_id,retryable,updated_at)
       VALUES ('job','owner',?,?,'analysis','entry','entry',1,'2026-01-01T00:00:00.000Z')`,
    )
    .run(status, generation);
}

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("job claim integration", () => {
  it("allows only one claim when duplicate deliveries race", async () => {
    current = testDatabase();
    seedJob(current.database);
    const claims = await Promise.all([
      claimJob(current.env, "job", "owner", 1, "understanding"),
      claimJob(current.env, "job", "owner", 1, "understanding"),
    ]);
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "not_claimable")).toHaveLength(1);
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM job_attempts").get()).toMatchObject({ count: 1 });
  });

  it("recovers an expired lease as the next bounded attempt", async () => {
    current = testDatabase();
    seedJob(current.database, "running");
    current.database
      .prepare(
        `INSERT INTO job_attempts
          (id,job_id,attempt_number,status,lease_expires_at,step_name,started_at)
         VALUES ('old','job',1,'running','2020-01-01T00:00:00.000Z','old','2020-01-01T00:00:00.000Z')`,
      )
      .run();
    const claim = await claimJob(current.env, "job", "owner", 1, "understanding");
    expect(claim).toMatchObject({ status: "claimed", attemptNumber: 2 });
    expect(current.database.prepare("SELECT status,error_code FROM job_attempts WHERE id='old'").get()).toMatchObject({
      status: "abandoned",
      error_code: "LEASE_EXPIRED",
    });
  });

  it("supersedes an old generation without creating an attempt", async () => {
    current = testDatabase();
    seedJob(current.database, "queued", 2);
    const claim = await claimJob(current.env, "job", "owner", 1, "understanding");
    expect(claim.status).toBe("superseded");
    expect(current.database.prepare("SELECT status FROM jobs WHERE id='job'").get()).toMatchObject({
      status: "superseded",
    });
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM job_attempts").get()).toMatchObject({ count: 0 });
  });

  it("does not let a late attempt failure overwrite its success", async () => {
    current = testDatabase();
    seedJob(current.database);
    const claim = await claimJob(current.env, "job", "owner", 1, "understanding");
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    await finishJobAttempt(current.env, claim.attemptId, "succeeded");
    await finishJobAttempt(current.env, claim.attemptId, "failed", "LATE_FAILURE");
    expect(
      current.database.prepare("SELECT status,error_code FROM job_attempts WHERE id=?").get(claim.attemptId),
    ).toMatchObject({ status: "succeeded", error_code: null });
  });
});
