import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  activationSchema,
  type CharacterEntryInput,
  characterEntryInputSchema,
  characterRecommendationResultSchema,
  correctionInputSchema,
  type FeedbackInput,
  feedbackInputSchema,
  generationRequestSchema,
  loginSchema,
  registrationSchema,
} from "../shared/schemas";
import { traitById } from "../shared/taxonomy";
import {
  csrfMiddleware,
  enforceQuota,
  rateLimitMiddleware,
  requireSession,
  resolveSession,
  sessionMiddleware,
  verifyTurnstile,
} from "./auth";
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from "./lib/cookies";
import {
  addDaysIso,
  addMinutesIso,
  constantTimeEqual,
  credentialDigestInput,
  deriveUuid,
  hmacHex,
  normalizeIdentityPart,
  normalizeUsername,
  nowIso,
  sha256Hex,
} from "./lib/crypto";
import { all, first, run } from "./lib/db";
import { boundedInteger } from "./lib/numbers";
import { loadCurrentProfile } from "./repository";
import { processAnalysis, rebuildProfileOnly } from "./services/analysis";
import { processFeedback } from "./services/feedback";
import { processGeneration } from "./services/generation";
import { hasRecommendationEvidence, processRecommendations } from "./services/recommendations";
import type {
  AnalysisWorkflowParams,
  AppVariables,
  Env,
  GenerationRow,
  GenerationWorkflowParams,
  RecommendationRunRow,
  RecommendationWorkflowParams,
} from "./types";

export { AnalysisWorkflow, GenerationWorkflow, RecommendationWorkflow } from "./workflows";

type AppEnv = { Bindings: Env; Variables: AppVariables };
const app = new Hono<AppEnv>();

const patchEntrySchema = z.object({
  revision: z.number().int().positive(),
  entry: characterEntryInputSchema,
});

const rotationSchema = z.object({ currentAccessKey: z.string().uuid() });

function apiData<T>(data: T) {
  return { data };
}

function recommendationRunData(row: RecommendationRunRow) {
  let result = null;
  if (row.result_json) {
    try {
      const parsed = characterRecommendationResultSchema.safeParse(JSON.parse(row.result_json));
      if (parsed.success) result = parsed.data;
    } catch {
      // Treat an invalid stored payload as unavailable instead of breaking the list endpoint.
    }
  }
  return {
    id: row.id,
    profileSnapshotId: row.profile_snapshot_id,
    status: row.status,
    result,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

function requireIdempotencyKey(value?: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Idempotency-KeyにはUUIDが必要です" });
  return parsed.data;
}

function identityKey(entry: CharacterEntryInput): Promise<string | null> {
  if (entry.kind === "original") return Promise.resolve(null);
  return sha256Hex(
    [
      normalizeIdentityPart(entry.workTitle),
      normalizeIdentityPart(entry.characterName),
      normalizeIdentityPart(entry.mediumOrEdition ?? ""),
    ].join("\u0000"),
  );
}

async function currentGeneration(db: D1Database, userId: string): Promise<number> {
  const row = await first<{ profile_generation: number }>(
    db.prepare("SELECT profile_generation FROM users WHERE id = ? AND status = 'active'").bind(userId),
  );
  if (!row) throw new HTTPException(401, { message: "ユーザーが見つかりません" });
  return row.profile_generation;
}

async function startAnalysis(context: Parameters<typeof requireSession>[0], params: AnalysisWorkflowParams) {
  if (context.env.ANALYSIS_WORKFLOW) {
    const instance = await context.env.ANALYSIS_WORKFLOW.create({ id: `analysis-${params.jobId}`, params });
    await context.env.DB.prepare("UPDATE jobs SET workflow_id = ? WHERE id = ?").bind(instance.id, params.jobId).run();
  } else {
    context.executionCtx.waitUntil(processAnalysis(context.env, params));
  }
}

async function startGeneration(context: Parameters<typeof requireSession>[0], params: GenerationWorkflowParams) {
  if (context.env.GENERATION_WORKFLOW) {
    const instance = await context.env.GENERATION_WORKFLOW.create({ id: `generation-${params.jobId}`, params });
    await context.env.DB.prepare("UPDATE jobs SET workflow_id = ? WHERE id = ?").bind(instance.id, params.jobId).run();
  } else {
    context.executionCtx.waitUntil(processGeneration(context.env, params));
  }
}

async function startRecommendations(
  context: Parameters<typeof requireSession>[0],
  params: RecommendationWorkflowParams,
) {
  if (context.env.RECOMMENDATION_WORKFLOW) {
    const instance = await context.env.RECOMMENDATION_WORKFLOW.create({
      id: `recommendation-${params.runId}`,
      params,
    });
    await context.env.DB.prepare("UPDATE character_recommendation_runs SET workflow_id = ? WHERE id = ?")
      .bind(instance.id, params.runId)
      .run();
  } else {
    context.executionCtx.waitUntil(processRecommendations(context.env, params));
  }
}

app.use("*", async (context, next) => {
  const requestId = context.req.header("CF-Ray") || crypto.randomUUID();
  context.set("requestId", requestId);
  const contentLength = Number(context.req.header("Content-Length") || 0);
  if (contentLength > 64_000) throw new HTTPException(413, { message: "リクエストが大きすぎます" });
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Frame-Options", "DENY");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (new URL(context.req.url).protocol === "https:")
    context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (context.req.path.startsWith("/api/")) context.header("Cache-Control", "no-store");
});

app.use("/api/v1/*", sessionMiddleware);
app.use("/api/v1/*", rateLimitMiddleware);
app.use("/api/v1/*", csrfMiddleware);

app.get("/api/v1/health", (context) => context.json(apiData({ status: "ok", environment: context.env.ENVIRONMENT })));

app.get("/api/v1/users", async (context) => {
  const query = normalizeUsername(context.req.query("query") ?? "");
  const cursor = context.req.query("cursor") ?? "";
  const limit = boundedInteger(context.req.query("limit"), 30, { max: 50 });
  const rows = await all<{ id: string; username: string; username_normalized: string; created_at: string }>(
    context.env.DB.prepare(`
      SELECT id, username, username_normalized, created_at
      FROM users
      WHERE status = 'active' AND username_normalized LIKE ? AND username_normalized > ?
      ORDER BY username_normalized ASC
      LIMIT ?
    `).bind(`%${query.replace(/[%_]/gu, "")}%`, cursor, limit + 1),
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return context.json(
    apiData({
      users: page.map(({ id, username }) => ({ id, username })),
      nextCursor: hasMore ? (page.at(-1)?.username_normalized ?? null) : null,
    }),
  );
});

app.post("/api/v1/users", zValidator("json", registrationSchema), async (context) => {
  const input = context.req.valid("json");
  await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key") || input.idempotencyKey);
  const userId = await deriveUuid(context.env.AUTH_PEPPER, `registration:user:${idempotencyKey}`);
  const accessKey = await deriveUuid(context.env.AUTH_PEPPER, `registration:key:${idempotencyKey}`);
  const username = input.username.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const normalized = normalizeUsername(username);
  await run(
    context.env.DB.prepare("DELETE FROM users WHERE status = 'pending' AND pending_expires_at <= ?").bind(nowIso()),
  );
  const existingById = await first<{
    id: string;
    username_normalized: string;
    status: string;
    pending_expires_at: string;
  }>(
    context.env.DB.prepare("SELECT id, username_normalized, status, pending_expires_at FROM users WHERE id = ?").bind(
      userId,
    ),
  );
  if (existingById) {
    if (
      existingById.username_normalized === normalized &&
      existingById.status === "pending" &&
      existingById.pending_expires_at > nowIso()
    ) {
      return context.json(
        apiData({
          user: { id: userId, username, status: "pending" },
          accessKey,
          expiresAt: existingById.pending_expires_at,
        }),
        200,
      );
    }
    throw new HTTPException(409, { message: "この作成リクエストは既に処理されています" });
  }
  const duplicate = await first<{ id: string }>(
    context.env.DB.prepare("SELECT id FROM users WHERE username_normalized = ? AND status != 'deleting'").bind(
      normalized,
    ),
  );
  if (duplicate) throw new HTTPException(409, { message: "そのユーザー名は既に使用されています" });
  const now = nowIso();
  const expiresAt = addMinutesIso(15);
  const digest = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(userId, accessKey));
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO users (id, username, username_normalized, status, created_at, pending_expires_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).bind(userId, username, normalized, now, expiresAt),
    context.env.DB.prepare(`
      INSERT INTO credentials (id, user_id, digest_hex, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).bind(crypto.randomUUID(), userId, digest, now),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "ユーザーを作成できませんでした" });
  return context.json(apiData({ user: { id: userId, username, status: "pending" }, accessKey, expiresAt }), 201);
});

app.post("/api/v1/users/:id/activate", zValidator("json", activationSchema), async (context) => {
  requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const userId = context.req.param("id");
  const { accessKey } = context.req.valid("json");
  const row = await first<{ digest_hex: string; pending_expires_at: string; status: string }>(
    context.env.DB.prepare(`
    SELECT c.digest_hex, u.pending_expires_at, u.status
    FROM users u JOIN credentials c ON c.user_id = u.id AND c.status = 'active'
    WHERE u.id = ?
  `).bind(userId),
  );
  const submitted = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(userId, accessKey));
  if (!row || !constantTimeEqual(row.digest_hex, submitted)) {
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  }
  if (row.status === "active") return context.json(apiData({ activated: true }));
  if (row.status !== "pending" || row.pending_expires_at <= nowIso()) {
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  }
  await run(
    context.env.DB.prepare(
      "UPDATE users SET status = 'active', activated_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(nowIso(), userId),
  );
  return context.json(apiData({ activated: true }));
});

app.post("/api/v1/sessions", zValidator("json", loginSchema), async (context) => {
  const input = context.req.valid("json");
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
  const row = await first<{ username: string; digest_hex: string }>(
    context.env.DB.prepare(`
    SELECT u.username, c.digest_hex
    FROM users u JOIN credentials c ON c.user_id = u.id AND c.status = 'active'
    WHERE u.id = ? AND u.status = 'active'
  `).bind(input.userId),
  );
  const submitted = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(input.userId, input.accessKey));
  if (!row || !constantTimeEqual(row.digest_hex, submitted)) {
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  }
  const sessionToken = await hmacHex(context.env.AUTH_PEPPER, `session\u0000${input.userId}\u0000${idempotencyKey}`);
  const tokenDigest = await sha256Hex(sessionToken);
  const csrfToken = await hmacHex(context.env.AUTH_PEPPER, `csrf\u0000${sessionToken}`);
  const csrfDigest = await sha256Hex(csrfToken);
  const days = boundedInteger(context.env.SESSION_DAYS, 30);
  const expiresAt = addDaysIso(days);
  await run(
    context.env.DB.prepare(`
    INSERT INTO sessions (token_digest_hex, user_id, csrf_digest_hex, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token_digest_hex) DO UPDATE SET
      csrf_digest_hex = excluded.csrf_digest_hex,
      expires_at = excluded.expires_at,
      revoked_at = NULL
  `).bind(tokenDigest, input.userId, csrfDigest, nowIso(), expiresAt),
  );
  context.header("Set-Cookie", sessionCookie(sessionToken, days * 86_400));
  return context.json(apiData({ user: { id: input.userId, username: row.username }, csrfToken, expiresAt }));
});

app.delete("/api/v1/sessions", async (context) => {
  requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
  if (token)
    await context.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_digest_hex = ?")
      .bind(nowIso(), await sha256Hex(token))
      .run();
  context.header("Set-Cookie", clearSessionCookie());
  return context.body(null, 204);
});

app.get("/api/v1/me", async (context) => {
  const session = requireSession(context);
  return context.json(
    apiData({
      user: { id: session.userId, username: session.username },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }),
  );
});

app.get("/api/v1/entries", async (context) => {
  const session = requireSession(context);
  const rows = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT e.id, e.kind, e.current_revision AS revision, e.created_at, e.updated_at,
      er.work_title AS workTitle, er.character_name AS characterName,
      er.medium_or_edition AS mediumOrEdition, er.overview,
      er.preference_rating AS preferenceRating, er.liked_aspects AS likedAspects,
      er.disliked_aspects AS dislikedAspects,
      (SELECT j.status FROM jobs j WHERE j.subject_id = e.id AND j.kind = 'analysis' ORDER BY j.created_at DESC LIMIT 1) AS analysisStatus
    FROM entries e
    JOIN entry_revisions er ON er.entry_id = e.id AND er.revision = e.current_revision
    WHERE e.user_id = ? AND e.status = 'active'
    ORDER BY e.updated_at DESC
  `).bind(session.userId),
  );
  return context.json(apiData({ entries: rows }));
});

app.post("/api/v1/entries", zValidator("json", characterEntryInputSchema), async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'analysis' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous)
    return context.json(
      apiData({
        job: { id: previous.id, status: previous.status, progress: previous.progress },
        entryId: previous.subject_id,
      }),
      202,
    );
  const input = context.req.valid("json");
  const entryId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const entryIdentity = await identityKey(input);
  if (entryIdentity) {
    const duplicate = await first<{ id: string }>(
      context.env.DB.prepare(
        "SELECT id FROM entries WHERE user_id = ? AND identity_key = ? AND status = 'active'",
      ).bind(session.userId, entryIdentity),
    );
    if (duplicate)
      throw new HTTPException(409, {
        message: "同じ作品・キャラクターは既に登録されています。既存の登録を編集してください",
      });
  }
  await enforceQuota(context.env, session.userId, "analysis");
  const inputHash = await sha256Hex(JSON.stringify(input));
  const statements = [
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      INSERT INTO entries (id, user_id, kind, identity_key, current_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).bind(entryId, session.userId, input.kind, entryIdentity, now, now),
    context.env.DB.prepare(`
      INSERT INTO entry_revisions (
        id, entry_id, user_id, revision, work_title, character_name, medium_or_edition,
        overview, preference_rating, liked_aspects, disliked_aspects, input_hash, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      revisionId,
      entryId,
      session.userId,
      input.kind === "existing" ? input.workTitle : null,
      input.characterName ?? null,
      input.kind === "existing" ? (input.mediumOrEdition ?? null) : null,
      input.overview,
      input.preferenceRating ?? null,
      input.likedAspects ?? null,
      input.dislikedAspects ?? null,
      inputHash,
      now,
    ),
    context.env.DB.prepare(`
      INSERT INTO jobs (
        id, user_id, kind, subject_id, profile_generation, idempotency_key,
        status, progress, created_at, updated_at
      ) SELECT ?, ?, 'analysis', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, entryId, idempotencyKey, now, now, session.userId),
  ];
  const results = await context.env.DB.batch(statements);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "キャラクターを登録できませんでした" });
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  await startAnalysis(context, {
    jobId,
    userId: session.userId,
    entryId,
    entryRevisionId: revisionId,
    profileGeneration,
  });
  return context.json(apiData({ entryId, job: { id: jobId, status: "queued", progress: 0 } }), 202);
});

app.get("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  const entry = await first<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT e.id, e.kind, e.current_revision AS revision, e.created_at, e.updated_at,
      er.work_title AS workTitle, er.character_name AS characterName,
      er.medium_or_edition AS mediumOrEdition, er.overview,
      er.preference_rating AS preferenceRating, er.liked_aspects AS likedAspects,
      er.disliked_aspects AS dislikedAspects
    FROM entries e JOIN entry_revisions er ON er.entry_id = e.id AND er.revision = e.current_revision
    WHERE e.id = ? AND e.user_id = ? AND e.status = 'active'
  `).bind(context.req.param("id"), session.userId),
  );
  if (!entry) throw new HTTPException(404, { message: "登録が見つかりません" });
  const assertions = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT ta.id, ta.trait_id AS traitId, ta.level, ta.observation, ta.confidence,
      ta.evidence_field AS evidenceField, ta.evidence_quote AS evidenceQuote,
      ta.source, t.label, t.category
    FROM trait_assertions ta
    LEFT JOIN traits t ON t.id = ta.trait_id AND t.taxonomy_version = '2026-08-v1'
    WHERE ta.entry_id = ? AND ta.user_id = ? AND ta.active = 1
    ORDER BY ta.confidence DESC
  `).bind(context.req.param("id"), session.userId),
  );
  return context.json(apiData({ entry, assertions }));
});

app.patch("/api/v1/entries/:id", zValidator("json", patchEntrySchema), async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const { revision, entry: input } = context.req.valid("json");
  const entryId = context.req.param("id");
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'analysis' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous) {
    if (previous.subject_id !== entryId)
      throw new HTTPException(409, { message: "冪等性キーが別の操作に使用されています" });
    const saved = await first<{ current_revision: number }>(
      context.env.DB.prepare("SELECT current_revision FROM entries WHERE id = ? AND user_id = ?").bind(
        entryId,
        session.userId,
      ),
    );
    return context.json(
      apiData({
        entryId,
        revision: saved?.current_revision,
        job: { id: previous.id, status: previous.status, progress: previous.progress },
      }),
      202,
    );
  }
  const current = await first<{ current_revision: number }>(
    context.env.DB.prepare(`
    SELECT current_revision FROM entries WHERE id = ? AND user_id = ? AND status = 'active'
  `).bind(entryId, session.userId),
  );
  if (!current) throw new HTTPException(404, { message: "登録が見つかりません" });
  if (current.current_revision !== revision)
    throw new HTTPException(409, { message: "別の更新が先に保存されています。再読み込みしてください" });
  await enforceQuota(context.env, session.userId, "analysis");
  const nextRevision = revision + 1;
  const revisionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const entryIdentity = await identityKey(input);
  const inputHash = await sha256Hex(JSON.stringify(input));
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      UPDATE entries SET kind = ?, identity_key = ?, current_revision = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND current_revision = ?
    `).bind(input.kind, entryIdentity, nextRevision, now, entryId, session.userId, revision),
    context.env.DB.prepare(`
      INSERT INTO entry_revisions (
        id, entry_id, user_id, revision, work_title, character_name, medium_or_edition,
        overview, preference_rating, liked_aspects, disliked_aspects, input_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      revisionId,
      entryId,
      session.userId,
      nextRevision,
      input.kind === "existing" ? input.workTitle : null,
      input.characterName ?? null,
      input.kind === "existing" ? (input.mediumOrEdition ?? null) : null,
      input.overview,
      input.preferenceRating ?? null,
      input.likedAspects ?? null,
      input.dislikedAspects ?? null,
      inputHash,
      now,
    ),
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, profile_generation, idempotency_key, status, progress, created_at, updated_at)
      SELECT ?, ?, 'analysis', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, entryId, idempotencyKey, now, now, session.userId),
  ]);
  if (results.some((result) => !result.success)) throw new HTTPException(500, { message: "更新できませんでした" });
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  await startAnalysis(context, {
    jobId,
    userId: session.userId,
    entryId,
    entryRevisionId: revisionId,
    profileGeneration,
  });
  return context.json(apiData({ entryId, revision: nextRevision, job: { id: jobId, status: "queued" } }), 202);
});

app.delete("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const entryId = context.req.param("id");
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'deletion' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous) {
    if (previous.subject_id !== entryId)
      throw new HTTPException(409, { message: "冪等性キーが別の操作に使用されています" });
    return context.json(
      apiData({ deleted: true, job: { id: previous.id, status: previous.status, progress: previous.progress } }),
      202,
    );
  }
  const vectors = await all<{ vector_id: string }>(
    context.env.DB.prepare(`
    SELECT ee.vector_id FROM entry_embeddings ee
    JOIN entry_revisions er ON er.id = ee.entry_revision_id
    JOIN entries e ON e.id = er.entry_id
    WHERE e.id = ? AND e.user_id = ?
  `).bind(entryId, session.userId),
  );
  const exists = await first<{ id: string }>(
    context.env.DB.prepare("SELECT id FROM entries WHERE id = ? AND user_id = ?").bind(entryId, session.userId),
  );
  if (!exists) throw new HTTPException(404, { message: "登録が見つかりません" });
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, profile_generation, idempotency_key, status, progress, created_at, updated_at)
      SELECT ?, ?, 'deletion', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, entryId, idempotencyKey, now, now, session.userId),
    context.env.DB.prepare("DELETE FROM entries WHERE id = ? AND user_id = ?").bind(entryId, session.userId),
  ]);
  if (results.some((result) => !result.success)) throw new HTTPException(500, { message: "削除できませんでした" });
  if (context.env.VECTORS && vectors.length)
    context.executionCtx.waitUntil(
      context.env.VECTORS.deleteByIds(vectors.map((item) => item.vector_id)).then(() => undefined),
    );
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  context.executionCtx.waitUntil(rebuildProfileOnly(context.env, { jobId, userId: session.userId, profileGeneration }));
  return context.json(apiData({ deleted: true, job: { id: jobId, status: "queued" } }), 202);
});

app.post("/api/v1/entries/:id/corrections", zValidator("json", correctionInputSchema), async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const entryId = context.req.param("id");
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'analysis' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous) {
    if (previous.subject_id !== entryId)
      throw new HTTPException(409, { message: "冪等性キーが別の操作に使用されています" });
    return context.json(
      apiData({ job: { id: previous.id, status: previous.status, progress: previous.progress } }),
      202,
    );
  }
  const input = context.req.valid("json");
  const row = await first<{ revision_id: string }>(
    context.env.DB.prepare(`
    SELECT er.id AS revision_id FROM entries e
    JOIN entry_revisions er ON er.entry_id = e.id AND er.revision = e.current_revision
    WHERE e.id = ? AND e.user_id = ? AND e.status = 'active'
  `).bind(entryId, session.userId),
  );
  if (!row) throw new HTTPException(404, { message: "登録が見つかりません" });
  const correctionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      INSERT INTO corrections (id, user_id, entry_id, trait_id, action, replacement_trait_id, preference, level, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      correctionId,
      session.userId,
      entryId,
      input.traitId,
      input.action,
      input.replacementTraitId ?? null,
      input.preference ?? null,
      input.level ?? null,
      input.note ?? null,
      now,
    ),
    context.env.DB.prepare(`
      UPDATE preference_signals SET active = 0
      WHERE user_id = ? AND entry_id = ? AND source_type = 'correction'
        AND trait_id IN (?, ?)
    `).bind(session.userId, entryId, input.traitId, input.replacementTraitId ?? input.traitId),
  ];
  if (input.action === "reject" || input.action === "replace") {
    statements.push(
      context.env.DB.prepare(`
      UPDATE trait_assertions SET active = 0
      WHERE user_id = ? AND entry_id = ? AND trait_id IN (?, ?)
    `).bind(session.userId, entryId, input.traitId, input.replacementTraitId ?? input.traitId),
    );
  }
  if (input.action === "confirm") {
    statements.push(
      context.env.DB.prepare(`
      UPDATE trait_assertions SET source = 'manual', confidence = 1
      WHERE user_id = ? AND entry_id = ? AND trait_id = ? AND active = 1
    `).bind(session.userId, entryId, input.traitId),
    );
  }
  if (input.action === "replace" && input.replacementTraitId) {
    const meta = traitById.get(input.replacementTraitId);
    statements.push(
      context.env.DB.prepare(`
      INSERT INTO trait_assertions (
        id, user_id, entry_id, entry_revision_id, model_run_id, trait_id, level,
        observation, confidence, evidence_field, evidence_quote, evidence_start,
        evidence_end, source, active, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'stated', 1, 'overview', ?, 0, 0, 'manual', 1, ?)
    `).bind(
        crypto.randomUUID(),
        session.userId,
        entryId,
        row.revision_id,
        input.replacementTraitId,
        input.level ?? null,
        input.note ?? `ユーザー訂正: ${meta?.label ?? input.replacementTraitId}`,
        now,
      ),
    );
  }
  if (input.preference && input.preference !== "neutral") {
    statements.push(
      context.env.DB.prepare(`
      INSERT INTO preference_signals (
        id, user_id, source_type, source_id, entry_id, trait_id, polarity, strength, evidence_quote, active, created_at
      ) VALUES (?, ?, 'correction', ?, ?, ?, ?, 1, ?, 1, ?)
    `).bind(
        crypto.randomUUID(),
        session.userId,
        correctionId,
        entryId,
        input.replacementTraitId ?? input.traitId,
        input.preference,
        input.note ?? null,
        now,
      ),
    );
  }
  statements.push(
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, profile_generation, idempotency_key, status, progress, created_at, updated_at)
      SELECT ?, ?, 'analysis', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, entryId, idempotencyKey, now, now, session.userId),
  );
  const results = await context.env.DB.batch(statements);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "訂正を保存できませんでした" });
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  context.executionCtx.waitUntil(rebuildProfileOnly(context.env, { jobId, userId: session.userId, profileGeneration }));
  return context.json(apiData({ correctionId, job: { id: jobId, status: "queued" } }), 202);
});

app.get("/api/v1/profile", async (context) => {
  const session = requireSession(context);
  const current = await loadCurrentProfile(context.env, session.userId);
  if (!current) {
    const count = await first<{ count: number }>(
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM entries WHERE user_id = ?").bind(session.userId),
    );
    return context.json(apiData({ profile: null, entryCount: count?.count ?? 0 }));
  }
  return context.json(apiData({ profileSnapshotId: current.id, profile: current.profile }));
});

app.get("/api/v1/recommendations", async (context) => {
  const session = requireSession(context);
  const rows = await all<RecommendationRunRow>(
    context.env.DB.prepare(`
      SELECT * FROM character_recommendation_runs
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).bind(session.userId),
  );
  return context.json(apiData({ recommendations: rows.map(recommendationRunData) }));
});

app.post("/api/v1/recommendations", async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const previous = await first<RecommendationRunRow>(
    context.env.DB.prepare(`
      SELECT * FROM character_recommendation_runs
      WHERE user_id = ? AND idempotency_key = ?
    `).bind(session.userId, idempotencyKey),
  );
  if (previous) return context.json(apiData({ recommendation: recommendationRunData(previous) }), 202);

  const profile = await loadCurrentProfile(context.env, session.userId);
  if (!profile || profile.profile.entryCount < 1)
    throw new HTTPException(409, { message: "分析済みのキャラクターが1件以上必要です" });
  if (!hasRecommendationEvidence(profile.profile))
    throw new HTTPException(409, { message: "推薦に使える好みの傾向がまだ見つかっていません" });

  await enforceQuota(context.env, session.userId, "recommendation");
  const runId = crypto.randomUUID();
  const now = nowIso();
  await run(
    context.env.DB.prepare(`
      INSERT INTO character_recommendation_runs (
        id, user_id, profile_snapshot_id, idempotency_key, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `).bind(runId, session.userId, profile.id, idempotencyKey, now, now),
  );
  try {
    await startRecommendations(context, { runId, userId: session.userId });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "character_recommendation_start_failed",
        runId,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    await context.env.DB.prepare(`
      UPDATE character_recommendation_runs
      SET status = 'failed', error_code = 'workflow_start_failed', updated_at = ?
      WHERE id = ? AND user_id = ?
    `)
      .bind(nowIso(), runId, session.userId)
      .run();
    throw new HTTPException(503, { message: "候補表示を開始できませんでした" });
  }
  const queued = await first<RecommendationRunRow>(
    context.env.DB.prepare("SELECT * FROM character_recommendation_runs WHERE id = ?").bind(runId),
  );
  if (!queued) throw new HTTPException(500, { message: "候補表示を開始できませんでした" });
  return context.json(apiData({ recommendation: recommendationRunData(queued) }), 202);
});

app.get("/api/v1/recommendations/:id", async (context) => {
  const session = requireSession(context);
  const row = await first<RecommendationRunRow>(
    context.env.DB.prepare("SELECT * FROM character_recommendation_runs WHERE id = ? AND user_id = ?").bind(
      context.req.param("id"),
      session.userId,
    ),
  );
  if (!row) throw new HTTPException(404, { message: "おすすめ候補が見つかりません" });
  return context.json(apiData({ recommendation: recommendationRunData(row) }));
});

app.get("/api/v1/generations", async (context) => {
  const session = requireSession(context);
  const rows = await all<GenerationRow>(
    context.env.DB.prepare(`
    SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).bind(session.userId),
  );
  return context.json(
    apiData({
      generations: rows.map((row) => ({
        id: row.id,
        profileSnapshotId: row.profile_snapshot_id,
        mode: row.mode,
        requestNote: row.request_note,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        similarityScore: row.similarity_score,
        similarityWarning: row.similarity_warning,
        status: row.status,
        createdAt: row.created_at,
      })),
    }),
  );
});

app.post("/api/v1/generations", zValidator("json", generationRequestSchema), async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'generation' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous)
    return context.json(
      apiData({
        generationId: previous.subject_id,
        job: { id: previous.id, status: previous.status, progress: previous.progress },
      }),
      202,
    );
  const profile = await loadCurrentProfile(context.env, session.userId);
  if (!profile || profile.profile.entryCount < 1)
    throw new HTTPException(409, { message: "分析済みのキャラクターが1件以上必要です" });
  await enforceQuota(context.env, session.userId, "generation");
  const input = context.req.valid("json");
  const generationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const results = await context.env.DB.batch([
    // jobs has no subject foreign key, while generations.job_id references jobs.
    // Insert in this order so D1's immediate foreign-key checks succeed.
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, idempotency_key, status, progress, created_at, updated_at)
      VALUES (?, ?, 'generation', ?, ?, 'queued', 0, ?, ?)
    `).bind(jobId, session.userId, generationId, idempotencyKey, now, now),
    context.env.DB.prepare(`
      INSERT INTO generations (
        id, user_id, profile_snapshot_id, job_id, mode, request_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).bind(generationId, session.userId, profile.id, jobId, input.mode, input.requestNote ?? null, now, now),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "生成を開始できませんでした" });
  await startGeneration(context, { jobId, userId: session.userId, generationId });
  return context.json(apiData({ generationId, job: { id: jobId, status: "queued" } }), 202);
});

app.get("/api/v1/generations/:id", async (context) => {
  const session = requireSession(context);
  const row = await first<GenerationRow>(
    context.env.DB.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ?").bind(
      context.req.param("id"),
      session.userId,
    ),
  );
  if (!row) throw new HTTPException(404, { message: "生成結果が見つかりません" });
  const feedback = await first<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT overall_rating AS overallRating, liked_trait_ids_json AS likedTraitIds,
      disliked_trait_ids_json AS dislikedTraitIds, intensity_adjustments_json AS intensityAdjustments,
      comment, revision
    FROM feedback_revisions WHERE generation_id = ? AND user_id = ? ORDER BY revision DESC LIMIT 1
  `).bind(row.id, session.userId),
  );
  return context.json(
    apiData({
      generation: {
        id: row.id,
        profileSnapshotId: row.profile_snapshot_id,
        mode: row.mode,
        requestNote: row.request_note,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        similarityScore: row.similarity_score,
        similarityWarning: row.similarity_warning,
        status: row.status,
        createdAt: row.created_at,
      },
      feedback,
    }),
  );
});

app.put("/api/v1/generations/:id/feedback", zValidator("json", feedbackInputSchema), async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const generationId = context.req.param("id");
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'feedback' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous) {
    if (previous.subject_id !== generationId)
      throw new HTTPException(409, { message: "冪等性キーが別の操作に使用されています" });
    return context.json(
      apiData({ job: { id: previous.id, status: previous.status, progress: previous.progress } }),
      202,
    );
  }
  const generation = await first<{ id: string }>(
    context.env.DB.prepare(`
    SELECT id FROM generations WHERE id = ? AND user_id = ? AND status = 'succeeded'
  `).bind(generationId, session.userId),
  );
  if (!generation) throw new HTTPException(404, { message: "生成結果が見つかりません" });
  const input = context.req.valid("json") as FeedbackInput;
  const revisionRow = await first<{ revision: number | null }>(
    context.env.DB.prepare(`
    SELECT MAX(revision) AS revision FROM feedback_revisions WHERE generation_id = ?
  `).bind(generationId),
  );
  const revision = (revisionRow?.revision ?? 0) + 1;
  const feedbackId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO feedback_revisions (
        id, generation_id, user_id, revision, overall_rating, liked_trait_ids_json,
        disliked_trait_ids_json, intensity_adjustments_json, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedbackId,
      generationId,
      session.userId,
      revision,
      input.overallRating ?? null,
      input.likedTraitIds ? JSON.stringify(input.likedTraitIds) : null,
      input.dislikedTraitIds ? JSON.stringify(input.dislikedTraitIds) : null,
      input.intensityAdjustments ? JSON.stringify(input.intensityAdjustments) : null,
      input.comment ?? null,
      now,
    ),
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, profile_generation, idempotency_key, status, progress, created_at, updated_at)
      SELECT ?, ?, 'feedback', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, generationId, idempotencyKey, now, now, session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "フィードバックを保存できませんでした" });
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  context.executionCtx.waitUntil(
    processFeedback(context.env, { jobId, userId: session.userId, generationId, profileGeneration }),
  );
  return context.json(apiData({ feedbackId, revision, job: { id: jobId, status: "queued" } }), 202);
});

app.delete("/api/v1/generations/:id/feedback", async (context) => {
  const session = requireSession(context);
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const generationId = context.req.param("id");
  const previous = await first<{ id: string; subject_id: string; status: string; progress: number }>(
    context.env.DB.prepare(`
    SELECT id, subject_id, status, progress FROM jobs
    WHERE user_id = ? AND kind = 'feedback' AND idempotency_key = ?
  `).bind(session.userId, idempotencyKey),
  );
  if (previous) {
    if (previous.subject_id !== generationId)
      throw new HTTPException(409, { message: "冪等性キーが別の操作に使用されています" });
    return context.json(
      apiData({ deleted: true, job: { id: previous.id, status: previous.status, progress: previous.progress } }),
      202,
    );
  }
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const results = await context.env.DB.batch([
    context.env.DB.prepare("DELETE FROM feedback_revisions WHERE generation_id = ? AND user_id = ?").bind(
      generationId,
      session.userId,
    ),
    context.env.DB.prepare(
      "UPDATE preference_signals SET active = 0 WHERE user_id = ? AND source_type = 'feedback' AND source_id = ?",
    ).bind(session.userId, generationId),
    context.env.DB.prepare(
      "UPDATE users SET profile_generation = profile_generation + 1 WHERE id = ? AND status = 'active'",
    ).bind(session.userId),
    context.env.DB.prepare(`
      INSERT INTO jobs (id, user_id, kind, subject_id, profile_generation, idempotency_key, status, progress, created_at, updated_at)
      SELECT ?, ?, 'feedback', ?, profile_generation, ?, 'queued', 0, ?, ? FROM users WHERE id = ?
    `).bind(jobId, session.userId, generationId, idempotencyKey, now, now, session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "フィードバックを削除できませんでした" });
  const profileGeneration = await currentGeneration(context.env.DB, session.userId);
  context.executionCtx.waitUntil(rebuildProfileOnly(context.env, { jobId, userId: session.userId, profileGeneration }));
  return context.json(apiData({ deleted: true, job: { id: jobId, status: "queued" } }), 202);
});

app.get("/api/v1/jobs/:id", async (context) => {
  const session = requireSession(context);
  const row = await first<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT id, kind, subject_id AS subjectId, status, progress, result_json AS result,
      error_code AS errorCode, created_at AS createdAt, updated_at AS updatedAt
    FROM jobs WHERE id = ? AND user_id = ?
  `).bind(context.req.param("id"), session.userId),
  );
  if (!row) throw new HTTPException(404, { message: "ジョブが見つかりません" });
  if (typeof row.result === "string") row.result = JSON.parse(row.result);
  return context.json(apiData({ job: row }));
});

app.post("/api/v1/account/key-rotation", zValidator("json", rotationSchema), async (context) => {
  const session = context.get("session") ?? (await resolveSession(context.env, context.req.header("Cookie"), true));
  if (!session) throw new HTTPException(401, { message: "ログインが必要です" });
  if (!context.get("session")) {
    const csrf = context.req.header("X-CSRF-Token");
    if (!csrf || !constantTimeEqual(csrf, session.csrfToken))
      throw new HTTPException(403, { message: "セキュリティトークンが無効です" });
  }
  const idempotencyKey = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const { currentAccessKey } = context.req.valid("json");
  const submitted = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(session.userId, currentAccessKey));
  const credential = await first<{ status: "active" | "revoked" }>(
    context.env.DB.prepare(`
    SELECT status FROM credentials WHERE user_id = ? AND digest_hex = ? ORDER BY created_at DESC LIMIT 1
  `).bind(session.userId, submitted),
  );
  if (!credential) throw new HTTPException(401, { message: "現在のアクセスキーが違います" });
  const nextKey = await deriveUuid(context.env.AUTH_PEPPER, `rotation:key:${session.userId}:${idempotencyKey}`);
  const digest = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(session.userId, nextKey));
  if (credential.status === "revoked") {
    const replay = await first<{ id: string }>(
      context.env.DB.prepare(
        "SELECT id FROM credentials WHERE user_id = ? AND digest_hex = ? AND status = 'active'",
      ).bind(session.userId, digest),
    );
    if (!replay) throw new HTTPException(401, { message: "現在のアクセスキーが違います" });
    context.header("Set-Cookie", clearSessionCookie());
    return context.json(apiData({ accessKey: nextKey, sessionsRevoked: true }));
  }
  const now = nowIso();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE credentials SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND status = 'active'",
    ).bind(now, session.userId),
    context.env.DB.prepare(`
      INSERT INTO credentials (id, user_id, digest_hex, version, status, created_at)
      SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, 'active', ? FROM credentials WHERE user_id = ?
    `).bind(crypto.randomUUID(), session.userId, digest, now, session.userId),
    context.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(now, session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "キーを変更できませんでした" });
  context.header("Set-Cookie", clearSessionCookie());
  return context.json(apiData({ accessKey: nextKey, sessionsRevoked: true }));
});

app.get("/api/v1/account/export", async (context) => {
  const session = requireSession(context);
  const user = await first<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT id, username, created_at AS createdAt, activated_at AS activatedAt FROM users WHERE id = ?
  `).bind(session.userId),
  );
  const entries = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT e.id, e.kind, er.* FROM entries e JOIN entry_revisions er ON er.entry_id = e.id
    WHERE e.user_id = ? ORDER BY e.created_at, er.revision
  `).bind(session.userId),
  );
  const profiles = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT id, version, profile_generation AS profileGeneration, profile_json AS profile, created_at AS createdAt
    FROM profile_snapshots WHERE user_id = ? ORDER BY version
  `).bind(session.userId),
  );
  const generations = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
    SELECT id, profile_snapshot_id AS profileSnapshotId, mode, request_note AS requestNote,
      result_json AS result, similarity_warning AS similarityWarning, created_at AS createdAt
    FROM generations WHERE user_id = ? ORDER BY created_at
  `).bind(session.userId),
  );
  const recommendations = await all<Record<string, unknown>>(
    context.env.DB.prepare(`
      SELECT id, profile_snapshot_id AS profileSnapshotId, result_json AS result,
        status, error_code AS errorCode, created_at AS createdAt
      FROM character_recommendation_runs WHERE user_id = ? ORDER BY created_at
    `).bind(session.userId),
  );
  for (const row of profiles) if (typeof row.profile === "string") row.profile = JSON.parse(row.profile);
  for (const row of generations) if (typeof row.result === "string") row.result = JSON.parse(row.result);
  for (const row of recommendations) if (typeof row.result === "string") row.result = JSON.parse(row.result);
  context.header("Content-Disposition", `attachment; filename="character-taste-export-${session.userId}.json"`);
  return context.json({ exportedAt: nowIso(), user, entries, profiles, generations, recommendations });
});

app.delete("/api/v1/account", async (context) => {
  const session = requireSession(context);
  requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const vectors = await all<{ vector_id: string }>(
    context.env.DB.prepare(`
    SELECT vector_id FROM entry_embeddings WHERE user_id = ?
    UNION ALL SELECT vector_id FROM generation_embeddings WHERE user_id = ?
  `).bind(session.userId, session.userId),
  );
  const results = await context.env.DB.batch([
    context.env.DB.prepare("UPDATE users SET status = 'deleting', deleted_at = ? WHERE id = ?").bind(
      nowIso(),
      session.userId,
    ),
    context.env.DB.prepare("DELETE FROM generations WHERE user_id = ?").bind(session.userId),
    context.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "アカウントを削除できませんでした" });
  if (context.env.VECTORS && vectors.length)
    context.executionCtx.waitUntil(
      context.env.VECTORS.deleteByIds(vectors.map((item) => item.vector_id)).then(() => undefined),
    );
  context.header("Set-Cookie", clearSessionCookie());
  return context.body(null, 204);
});

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  const status = error instanceof HTTPException ? error.status : 500;
  const message = error instanceof HTTPException ? error.message : "予期しないエラーが発生しました";
  const code =
    status === 500
      ? "internal_error"
      : status === 401 && message === "ログインが必要です"
        ? "session_required"
        : `http_${status}`;
  const expectedAnonymousProbe = status === 401 && context.req.method === "GET" && context.req.path === "/api/v1/me";
  if (!expectedAnonymousProbe) {
    const log = JSON.stringify({
      event: status >= 500 ? "request_failed" : "request_rejected",
      requestId,
      status,
      method: context.req.method,
      path: context.req.path,
      error: error.name,
    });
    if (status >= 500) console.error(log);
    else console.warn(log);
  }
  return context.json({ error: { code, message, requestId } }, status as 400);
});

app.notFound((context) =>
  context.json(
    { error: { code: "not_found", message: "ページが見つかりません", requestId: context.get("requestId") } },
    404,
  ),
);

export default app;
