import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rejectPreferenceAnalysisItem } from "../worker/features/entries/preference-review";
import { claimJob, finishJobAttempt } from "../worker/features/jobs/execution";
import { dispatchPendingProfileRebuild } from "../worker/runtime/outbox";
import type { Env } from "../worker/types";
import { testDatabase } from "./support/database";
import { fixtureTime, insertFixture, seedEntry, seedReview, seedUser } from "./support/fixtures";

function seedJob(database: DatabaseSync, status = "queued", generation = 1) {
  seedUser(database);
  seedEntry(database, { generation });
  database
    .prepare(
      `INSERT INTO jobs
        (id,owner_user_id,status,input_generation,job_type,target_type,target_id,retryable,created_at,updated_at)
       VALUES ('job','owner',?,?,'character_analysis','entry','entry',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`,
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
    const { database, env } = testDatabase();
    seedReview(database);
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
    const { database, env: context } = testDatabase();
    for (const owner of ["owner", "other"]) {
      seedUser(database, owner);
      insertFixture(database, "jobs", {
        id: owner + "-job",
        owner_user_id: owner,
        job_type: "profile_rebuild",
        status: "queued",
        target_type: "profile",
        target_id: owner,
        input_generation: 1,
        created_at: fixtureTime,
        updated_at: fixtureTime,
      });
      insertFixture(database, "outbox_events", {
        id: owner + "-event",
        owner_user_id: owner,
        aggregate_type: "job",
        aggregate_id: owner + "-job",
        aggregate_revision: 1,
        event_type: "profile.rebuild",
        payload_json: JSON.stringify({
          type: "profile.rebuild",
          params: { jobId: owner + "-job", ownerUserId: owner, desiredGeneration: 1 },
        }),
        payload_hash: owner,
        correlation_id: owner,
        deduplication_key: owner,
        status: "pending",
        available_at: fixtureTime,
        created_at: fixtureTime,
      });
    }
    const create = vi.fn(async ({ id }: { id: string }) => ({ id }));
    const env = {
      DB: context.DB,
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
