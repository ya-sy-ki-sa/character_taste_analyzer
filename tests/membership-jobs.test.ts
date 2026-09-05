// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { evaluationDatabase } from "../scripts/lib/evaluation-database";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { type MembershipTier, membershipTierSchema } from "../shared/membership";
import type { GenerationValidationReport } from "../shared/schemas";
import { anyEntryDraftSchema, generationRequestInputSchema } from "../shared/schemas";
import { app } from "../worker/app";
import * as llmProviders from "../worker/llm/providers";
import type { StructuredLlmRequest } from "../worker/llm/types";
import {
  activateAnalysisAndRebuild,
  processCharacterAnalysis,
  processPreferenceAnalysis,
} from "../worker/services/analysis";
import { confirmUnderstanding, createEntry, createEntryReanalysis, loadEntryReview } from "../worker/services/entries";
import { createGenerationRequest, listGenerations, processGeneration } from "../worker/services/generation";
import { createJobLlmProvider } from "../worker/services/llm-execution";
import { dispatchOutboxEvent } from "../worker/services/orchestration";
import { refinePreferenceInput } from "../worker/services/preference-refinement";
import { processProfileRebuild } from "../worker/services/profile";
import type { Env } from "../worker/types";

const databases: Array<ReturnType<typeof evaluationDatabase>> = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(tier: MembershipTier = "basic") {
  const db = evaluationDatabase();
  databases.push(db);
  const owner = crypto.randomUUID(),
    now = new Date().toISOString();
  db.database
    .prepare(
      "INSERT INTO users (id,username,username_normalized,status,membership_tier,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)",
    )
    .run(owner, owner, owner, tier, now, now);
  const env = {
    DB: db.DB,
    ENVIRONMENT: "local",
    APP_ORIGIN: "https://lab.example",
    AUTH_PEPPER: "membership-test-only",
    LLM_PROVIDER: "fake",
    LLM_MODEL: "common-original",
    LLM_TIER_ROUTES_JSON: JSON.stringify(
      Object.fromEntries(
        membershipTierSchema.options.map((item) => [item, { provider: "fake", model: `${item}-original` }]),
      ),
    ),
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    MODERATION_PROVIDER: "fake",
    ANALYSIS_DAILY_QUOTA: "100",
    GENERATION_DAILY_QUOTA: "100",
    SESSION_DAYS: "30",
  } as Env;
  return { db, owner, env };
}
function draft(domain: AnalysisDomain) {
  return anyEntryDraftSchema.parse({
    registrationType: "original",
    characterName: "試験対象",
    characterBasicInfo: "冷酷な知略で支配を行う悪役。外部から操作されることもある。",
    preference: {
      likedReasons: "冷酷な知略で支配する悪役としての姿が好き。改心しないところも好き。",
      responseChannels: [domain === "dark" ? "villain_role_fascination" : "narrative_interest"],
    },
    ...(domain === "dark" ? { darkContext: { focusDescription: "外部から操作されて敵対する状態" } } : {}),
  });
}
function snapshot(db: ReturnType<typeof evaluationDatabase>, jobId: string) {
  return JSON.parse(
    db.database.prepare("SELECT llm_routing_snapshot_json FROM jobs WHERE id=?").get(jobId)
      ?.llm_routing_snapshot_json as string,
  );
}
const probeSchema = z.object({ ok: z.boolean() });
const probe = {
  operation: "preference_analysis" as const,
  schemaName: "probe",
  schemaVersion: "1",
  schema: probeSchema,
  jsonSchema: z.toJSONSchema(probeSchema) as Record<string, unknown>,
  messages: [],
  maxOutputTokens: 100,
  temperature: 0,
  idempotencyKey: "probe",
  fakeFactory: () => ({ ok: true }),
};

describe("membership persistence and authentication", () => {
  it("migrates existing users and enforces the four tiers and non-null default", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const root = "docs/詳細設計/database";
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && !name.startsWith("006_"))
        .sort())
        db.exec(readFileSync(`${root}/${file}`, "utf8"));
      db.exec(
        "INSERT INTO users (id,username,username_normalized,status,created_at,updated_at) VALUES ('old','old','old','active','now','now')",
      );
      db.exec(readFileSync(`${root}/006_membership_llm_routing.sql`, "utf8"));
      expect(db.prepare("SELECT membership_tier FROM users WHERE id='old'").get()?.membership_tier).toBe("basic");
      for (const tier of membershipTierSchema.options)
        db.prepare("UPDATE users SET membership_tier=? WHERE id='old'").run(tier);
      expect(() => db.exec("UPDATE users SET membership_tier='admin'")).toThrow();
      expect(() => db.exec("UPDATE users SET membership_tier=NULL")).toThrow();
      db.exec(
        "INSERT INTO users (id,username,username_normalized,status,created_at,updated_at) VALUES ('new','new','new','pending','now','now')",
      );
      expect(db.prepare("SELECT membership_tier FROM users WHERE id='new'").get()?.membership_tier).toBe("basic");
    } finally {
      db.close();
    }
  });

  it("returns server-owned tiers for registration replay, activation, login and an existing session", async () => {
    const { db, env } = setup();
    const key = crypto.randomUUID();
    const send = (path: string, body?: unknown, cookie?: string) =>
      app.request(
        `https://lab.example/api/v1${path}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            Origin: "https://lab.example",
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        env,
      );
    const response = await send("/users", {
      username: "ティア試験",
      membershipTier: "premium",
      membership_tier: "premium",
      model: "untrusted-model",
    });
    expect(response.status).toBe(201);
    const { data: created } = (await response.json()) as {
      data: { user: { id: string; membershipTier: string }; accessKey: string };
    };
    expect(created.user.membershipTier).toBe("basic");
    expect(
      (await (
        await send(`/users/${created.user.id}/activate`, { accessKey: created.accessKey, membershipTier: "premium" })
      ).json()) as object,
    ).toMatchObject({ data: { user: { membershipTier: "basic" } } });
    const login = await send("/sessions", {
      username: "ティア試験",
      accessKey: created.accessKey,
      membershipTier: "premium",
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ data: { user: { membershipTier: "basic" } } });
    const cookie = login.headers.get("Set-Cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    db.database.prepare("UPDATE users SET membership_tier='gold' WHERE id=?").run(created.user.id);
    expect(await (await send("/me", undefined, cookie)).json()).toMatchObject({
      data: { user: { membershipTier: "gold" } },
    });
    expect(await (await send("/users", { username: "ティア試験" })).json()).toMatchObject({
      data: { user: { membershipTier: "gold" } },
    });
    expect(
      await (await send(`/users/${created.user.id}/activate`, { accessKey: created.accessKey })).json(),
    ).toMatchObject({ data: { user: { membershipTier: "gold" } } });
  });
});

describe.each(["standard", "dark"] as const)("%s job routing", (domain) => {
  it.each(membershipTierSchema.options)("pins %s across analysis, review, hypotheses and generation", async (tier) => {
    const { db, env, owner } = setup(tier);
    const fetchMock = vi.fn(() => {
      throw new Error("Unexpected remote call");
    });
    vi.stubGlobal("fetch", fetchMock);
    const entry = await createEntry(env, owner, domain, draft(domain), crypto.randomUUID());
    const saved = snapshot(db, entry.jobId);
    expect(saved.membershipTier).toBe(tier);
    const params = {
      jobId: entry.jobId,
      ownerUserId: owner,
      entryId: entry.entryId,
      stage: "understanding" as const,
      inputGeneration: 1,
      analysisDomain: domain,
    };
    // The actual dispatcher uses these same service entrypoints in local mode.
    env.LLM_MODEL = "common-changed";
    env.LLM_TIER_ROUTES_JSON = "{}";
    db.database.prepare("UPDATE users SET membership_tier='premium' WHERE id=?").run(owner);
    expect(await dispatchOutboxEvent(env, entry.outboxEventId as string)).toBe(true);
    const understanding = (await loadEntryReview(env, owner, domain, entry.entryId))?.understanding;
    expect(understanding).toBeTruthy();
    await confirmUnderstanding(env, owner, domain, understanding?.id as string);
    await processPreferenceAnalysis(env, { ...params, stage: "preference" });
    const preference = (await loadEntryReview(env, owner, domain, entry.entryId))?.preferenceAnalysis;
    expect(preference).toBeTruthy();
    const hypothesis = await refinePreferenceInput(
      env,
      owner,
      domain,
      entry.entryId,
      { mode: "hypotheses" },
      crypto.randomUUID(),
    );
    await processPreferenceAnalysis(env, { ...params, stage: "preference", refinementId: hypothesis.id });
    expect(
      (await loadEntryReview(env, owner, domain, entry.entryId))?.preferenceAnalysis?.hypothesisPreview,
    ).toBeTruthy();
    expect(snapshot(db, entry.jobId)).toEqual(saved);
    const analysisRuns = db.database
      .prepare("SELECT operation,requested_model,effective_settings_json FROM model_run_metadata WHERE owner_user_id=?")
      .all(owner);
    expect(analysisRuns.map((run) => run.operation)).toEqual(
      expect.arrayContaining(
        domain === "dark"
          ? [
              "dark_scope_assessment",
              "dark_character_understanding",
              "dark_understanding_audit",
              "dark_preference_analysis",
              "dark_preference_audit",
              "preference_hypotheses",
            ]
          : [
              "customization_delta",
              "understanding_audit",
              "preference_analysis",
              "preference_audit",
              "preference_hypotheses",
            ],
      ),
    );
    for (const run of analysisRuns) {
      expect(run.requested_model).toBe(
        run.operation === "dark_scope_assessment" ? "common-original" : `${tier}-original`,
      );
      expect(JSON.parse(run.effective_settings_json as string).llmRouting).toMatchObject({
        membershipTier: tier,
        operation: run.operation,
        jobId: entry.jobId,
      });
    }
    const activated = await activateAnalysisAndRebuild(env, owner, domain, preference?.id as string);
    await processProfileRebuild(env, {
      jobId: activated.profileJobId,
      ownerUserId: owner,
      desiredGeneration: activated.freshness.desiredGeneration,
    });
    const ids = db.database
      .prepare("SELECT id FROM profile_snapshot_items WHERE analysis_domain=? ORDER BY ordinal LIMIT 3")
      .all(domain)
      .map((row) => row.id as string);
    expect(ids.length).toBeGreaterThan(0);
    // A new generation job sees the new server-side tier and configuration.
    const generation = await createGenerationRequest(
      env,
      owner,
      domain,
      generationRequestInputSchema.parse({ mode: "faithful", purpose: "独創的な人物を作成", selectedItemIds: ids }),
      crypto.randomUUID(),
    );
    expect(snapshot(db, generation.jobId as string)).toMatchObject({
      membershipTier: "premium",
      tier: { primary: { model: "common-changed" } },
    });
    env.LLM_MODEL = "changed-again";
    env.LLM_TIER_ROUTES_JSON = '{"premium":{"provider":"openai","model":"must-not-call"}}';
    // Return a semantic rejection on the first inspection, then a valid repaired
    // inspection. Keep the actual router and metadata persistence in this test.
    const createProvider = llmProviders.createLlmProvider;
    vi.spyOn(llmProviders, "createLlmProvider").mockImplementation((bindings, context) => {
      const llm = createProvider(bindings, context);
      const generate = llm.generateStructured.bind(llm);
      llm.generateStructured = <T>(request: StructuredLlmRequest<T>) =>
        generate({
          ...request,
          fakeFactory: () => {
            const value = request.fakeFactory();
            if (request.operation !== "generation_validation" || !request.idempotencyKey.endsWith(":initial"))
              return value;
            const report = value as GenerationValidationReport;
            return {
              ...report,
              passed: false,
              checks: report.checks.map((check, index) => (index === 0 ? { ...check, status: "uncertain" } : check)),
            } as T;
          },
        });
      return llm;
    });
    await processGeneration(env, {
      jobId: generation.jobId as string,
      ownerUserId: owner,
      generationRequestId: generation.generationRequestId,
      inputGeneration: 1,
      analysisDomain: domain,
    });
    expect((await listGenerations(env, owner, domain))[0].status).toBe("generated");
    const generationRuns = db.database
      .prepare(
        "SELECT operation,requested_model,effective_settings_json FROM model_run_metadata WHERE operation IN ('character_generation','dark_character_generation','generation_validation','generation_repair','generation_comparison')",
      )
      .all();
    expect(generationRuns.map((run) => run.operation)).toEqual(
      expect.arrayContaining([
        domain === "dark" ? "dark_character_generation" : "character_generation",
        "generation_validation",
        "generation_repair",
        "generation_comparison",
      ]),
    );
    for (const run of generationRuns) {
      expect(run.requested_model).toBe("common-changed");
      expect(JSON.parse(run.effective_settings_json as string).llmRouting).toMatchObject({
        membershipTier: "premium",
        jobId: generation.jobId,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects client tier/model fields and snapshots the current tier for reanalysis", async () => {
    const { db, env, owner } = setup("silver");
    expect(() =>
      anyEntryDraftSchema.parse({ ...draft(domain), membershipTier: "premium", model: "untrusted" }),
    ).toThrow();
    const entry = await createEntry(env, owner, domain, draft(domain), crypto.randomUUID());
    await processCharacterAnalysis(env, {
      jobId: entry.jobId,
      ownerUserId: owner,
      entryId: entry.entryId,
      stage: "understanding",
      inputGeneration: 1,
      analysisDomain: domain,
    });
    db.database.prepare("UPDATE users SET membership_tier='gold' WHERE id=?").run(owner);
    const key = crypto.randomUUID();
    const reanalysis = await createEntryReanalysis(env, owner, domain, entry.entryId, { draft: draft(domain) }, key);
    expect(reanalysis.jobId).not.toBe(entry.jobId);
    expect(snapshot(db, reanalysis.jobId)).toMatchObject({
      membershipTier: "gold",
      tier: { primary: { model: "gold-original" } },
    });
    db.database.prepare("UPDATE users SET membership_tier='premium' WHERE id=?").run(owner);
    const replay = await createEntryReanalysis(env, owner, domain, entry.entryId, { draft: draft(domain) }, key);
    expect(replay.jobId).toBe(reanalysis.jobId);
    expect(snapshot(db, replay.jobId).membershipTier).toBe("gold");
  });

  it("initializes a legacy job once with basic and common routes, with owner isolation", async () => {
    const { db, env, owner } = setup("premium");
    const entry = await createEntry(env, owner, domain, draft(domain), crypto.randomUUID());
    db.database.prepare("UPDATE jobs SET llm_routing_snapshot_json=NULL WHERE id=?").run(entry.jobId);
    await expect(createJobLlmProvider(env, entry.jobId, "another-user")).rejects.toThrow("LLM_JOB_NOT_FOUND");
    expect(
      db.database.prepare("SELECT llm_routing_snapshot_json FROM jobs WHERE id=?").get(entry.jobId)
        ?.llm_routing_snapshot_json,
    ).toBeNull();
    await Promise.all([createJobLlmProvider(env, entry.jobId, owner), createJobLlmProvider(env, entry.jobId, owner)]);
    const saved = snapshot(db, entry.jobId);
    expect(saved).toMatchObject({ membershipTier: "basic", tier: { primary: { model: "common-original" } } });
    env.LLM_MODEL = "changed";
    const llm = await createJobLlmProvider(env, entry.jobId, owner);
    expect((await llm.generateStructured(probe)).metadata.requestedModel).toBe("common-original");
    expect(snapshot(db, entry.jobId)).toEqual(saved);
  });

  it("preserves premium failures and model selection through the existing three-attempt limit", async () => {
    const { db, env, owner } = setup("premium");
    const run = vi.fn(async () => {
      throw new Error("429 capacity exceeded");
    });
    env.AI = { run };
    env.AI_GATEWAY_GATEWAY_ID = "test";
    env.LLM_TIER_ROUTES_JSON = '{"premium":{"provider":"workers_ai","model":"premium-remote"}}';
    env.LLM_FALLBACK_PROVIDER = "fake";
    env.LLM_FALLBACK_MODEL = "fake-v1";
    const entry = await createEntry(env, owner, domain, draft(domain), crypto.randomUUID());
    const saved = snapshot(db, entry.jobId);
    env.LLM_TIER_ROUTES_JSON = "{}";
    db.database.prepare("UPDATE users SET membership_tier='basic' WHERE id=?").run(owner);
    const params = {
      jobId: entry.jobId,
      ownerUserId: owner,
      entryId: entry.entryId,
      stage: "understanding" as const,
      inputGeneration: 1,
      analysisDomain: domain,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt < 2)
        await expect(processCharacterAnalysis(env, params)).rejects.toMatchObject({
          code: "PROVIDER_CAPACITY_EXHAUSTED",
        });
      else await processCharacterAnalysis(env, params);
      expect(
        db.database.prepare("SELECT status,error_code,retryable FROM jobs WHERE id=?").get(entry.jobId),
      ).toMatchObject({
        status: attempt < 2 ? "retrying" : "failed",
        error_code: "PROVIDER_CAPACITY_EXHAUSTED",
        retryable: attempt < 2 ? 1 : 0,
      });
    }
    await processCharacterAnalysis(env, params);
    expect(db.database.prepare("SELECT error_code,retryable FROM jobs WHERE id=?").get(entry.jobId)).toMatchObject({
      error_code: "JOB_STEP_ATTEMPTS_EXHAUSTED",
      retryable: 0,
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(snapshot(db, entry.jobId)).toEqual(saved);
    const failures = db.database
      .prepare("SELECT effective_settings_json FROM model_run_metadata WHERE requested_model='premium-remote'")
      .all();
    expect(failures).toHaveLength(3);
    for (const failure of failures)
      expect(JSON.parse(failure.effective_settings_json as string).llmRouting).toMatchObject({
        membershipTier: "premium",
        fallback: null,
      });
  });
});
