import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rejectPreferenceAnalysisItem } from "../worker/services/entries";
import { claimJob, finishJobAttempt } from "../worker/services/jobs";
import { dispatchPendingProfileRebuild } from "../worker/services/orchestration";
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
    expect(claim).toMatchObject({ status: "claimed", attemptNumber: 2, stepAttemptNumber: 1 });
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

  it("starts a new step after the previous step used all three attempts", async () => {
    current = testDatabase();
    seedJob(current.database);
    const insert = current.database.prepare(
      `INSERT INTO job_attempts
        (id,job_id,attempt_number,status,step_name,started_at,finished_at)
       VALUES (?,?,?,'failed','understandCharacter','2026-01-01T00:00:00.000Z','2026-01-01T00:00:01.000Z')`,
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) insert.run(`understanding-${attempt}`, "job", attempt);

    const claim = await claimJob(current.env, "job", "owner", 1, "preferenceAnalysis");

    expect(claim).toMatchObject({ status: "claimed", attemptNumber: 4, stepAttemptNumber: 1 });
    expect(
      current.database.prepare("SELECT attempt_number,step_name FROM job_attempts WHERE status='running'").get(),
    ).toMatchObject({ attempt_number: 4, step_name: "preferenceAnalysis" });
  });

  it("enforces the three-attempt limit within each step", async () => {
    current = testDatabase();
    seedJob(current.database);
    const insert = current.database.prepare(
      `INSERT INTO job_attempts
        (id,job_id,attempt_number,status,step_name,started_at,finished_at)
       VALUES (?,?,?,'failed','preferenceAnalysis','2026-01-01T00:00:00.000Z','2026-01-01T00:00:01.000Z')`,
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) insert.run(`preference-${attempt}`, "job", attempt);

    await expect(claimJob(current.env, "job", "owner", 1, "preferenceAnalysis")).resolves.toMatchObject({
      status: "attempts_exhausted",
    });
    expect(current.database.prepare("SELECT COUNT(*) AS count FROM job_attempts").get()).toMatchObject({ count: 3 });
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

describe("preference review integration", () => {
  it("rejects an individual preference or value stance and keeps retries idempotent", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE user_character_entries (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, active_revision_number INTEGER NOT NULL, status TEXT NOT NULL,
        analysis_domain TEXT NOT NULL DEFAULT 'standard'
      );
      CREATE TABLE entry_revisions (
        id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, revision_number INTEGER NOT NULL
      );
      CREATE TABLE analysis_runs (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, entry_revision_id TEXT NOT NULL, status TEXT NOT NULL, run_generation INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE preference_assertions (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, analysis_run_id TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE value_stance_assertions (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, analysis_run_id TEXT NOT NULL, status TEXT NOT NULL
      );
      INSERT INTO user_character_entries VALUES ('entry','owner',1,'analysis_review','standard');
      INSERT INTO entry_revisions VALUES ('revision','entry',1);
      INSERT INTO analysis_runs VALUES ('run','owner','revision','succeeded',1);
      INSERT INTO preference_assertions VALUES ('preference','owner','run','proposed');
      INSERT INTO value_stance_assertions VALUES ('stance','owner','run','proposed');
    `);
    const d1 = {
      prepare(sql: string) {
        return new TestStatement(database, sql);
      },
    } as unknown as D1Database;
    const env = { DB: d1 } as unknown as Env;
    try {
      await expect(rejectPreferenceAnalysisItem(env, "owner", "standard", "run", "preference")).resolves.toMatchObject({
        targetType: "preference_assertion",
        replayed: false,
      });
      await expect(rejectPreferenceAnalysisItem(env, "owner", "standard", "run", "preference")).resolves.toMatchObject({
        replayed: true,
      });
      await expect(rejectPreferenceAnalysisItem(env, "owner", "standard", "run", "stance")).resolves.toMatchObject({
        targetType: "value_stance_assertion",
        replayed: false,
      });
      expect(database.prepare("SELECT status FROM preference_assertions WHERE id='preference'").get()).toMatchObject({
        status: "rejected",
      });
      expect(database.prepare("SELECT status FROM value_stance_assertions WHERE id='stance'").get()).toMatchObject({
        status: "rejected",
      });
      await expect(rejectPreferenceAnalysisItem(env, "another-owner", "standard", "run", "preference")).rejects.toThrow(
        "PREFERENCE_REVIEW_NOT_FOUND",
      );
    } finally {
      database.close();
    }
  });
});

describe("profile rebuild outbox recovery", () => {
  it("dispatches only the pending profile rebuild owned by the current user", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL, available_at TEXT NOT NULL, lease_owner TEXT,
        lease_expires_at TEXT, last_error_code TEXT, published_at TEXT
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, workflow_instance_id TEXT, updated_at TEXT
      );
      INSERT INTO jobs VALUES ('owner-job','queued',NULL,NULL), ('other-job','queued',NULL,NULL);
      INSERT INTO outbox_events VALUES (
        'owner-event','owner','owner-job','profile.rebuild',
        '{"type":"profile.rebuild","params":{"jobId":"owner-job","ownerUserId":"owner","desiredGeneration":1}}',
        'pending',0,'2026-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL
      );
      INSERT INTO outbox_events VALUES (
        'other-event','other','other-job','profile.rebuild',
        '{"type":"profile.rebuild","params":{"jobId":"other-job","ownerUserId":"other","desiredGeneration":1}}',
        'pending',0,'2026-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL
      );
    `);
    const d1 = {
      prepare(sql: string) {
        return new TestStatement(database, sql);
      },
      async batch(statements: TestStatement[]) {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      },
    } as unknown as D1Database;
    const create = vi.fn(async ({ id }: { id: string }) => ({ id }));
    const env = {
      DB: d1,
      PROFILE_REBUILD_WORKFLOW: { create, get: vi.fn() },
    } as unknown as Env;

    try {
      await expect(dispatchPendingProfileRebuild(env, "owner")).resolves.toBe(true);
      expect(create).toHaveBeenCalledWith({
        id: "profile-owner-event",
        params: { jobId: "owner-job", ownerUserId: "owner", desiredGeneration: 1 },
      });
      expect(database.prepare("SELECT status FROM outbox_events WHERE id='owner-event'").get()).toMatchObject({
        status: "published",
      });
      expect(database.prepare("SELECT status FROM outbox_events WHERE id='other-event'").get()).toMatchObject({
        status: "pending",
      });
    } finally {
      database.close();
    }
  });
});
