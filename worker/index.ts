import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  accountDeletionSchema,
  accountExportRequestSchema,
  activationSchema,
  batchReviewSchema,
  entryReanalysisSchema,
  entrySubmissionSchema,
  generationRequestInputSchema,
  identityCandidateRequestSchema,
  keyRotationSchema,
  loginSchema,
  registrationSchema,
  understandingReviewRequestSchema,
} from "../shared/schemas";
import { csrfMiddleware, rateLimitMiddleware, requireSession, sessionMiddleware, verifyTurnstile } from "./auth";
import { validateConfig } from "./config";
import { createEmbeddingProvider } from "./embedding/providers";
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from "./lib/cookies";
import {
  addDaysIso,
  addMinutesIso,
  constantTimeEqual,
  credentialDigestInput,
  deriveUuid,
  hmacHex,
  normalizeUsername,
  nowIso,
  randomToken,
  sha256Hex,
} from "./lib/crypto";
import { all, first } from "./lib/db";
import { boundedInteger } from "./lib/numbers";
import { runDailyCleanup } from "./services/cleanup";
import { createAccountExport } from "./services/exports";
import { dispatchOutboxEvent, dispatchPendingOutbox } from "./services/orchestration";
import { createDataStoreStrategy } from "./storage/strategy";
import type { AppVariables, Env } from "./types";

export {
  AccountExportWorkflow,
  CharacterAnalysisWorkflow,
  GenerationWorkflow,
  ProfileRebuildWorkflow,
} from "./workflows";

type AppEnv = { Bindings: Env; Variables: AppVariables };
const app = new Hono<AppEnv>();

function data<T>(value: T) {
  return { data: value };
}

function validateJson<Schema extends z.ZodType>(schema: Schema) {
  return zValidator("json", schema, (result, context) => {
    if (result.success) return;
    return context.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください",
          requestId: (context as unknown as { get(key: string): string }).get("requestId"),
          details: result.error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
        },
      },
      400,
    );
  });
}

function requireIdempotencyKey(value?: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Idempotency-KeyにはUUIDが必要です" });
  return parsed.data;
}

function dispatchAfterCommit(context: Parameters<typeof requireSession>[0], eventId?: string) {
  if (eventId) context.executionCtx.waitUntil(dispatchOutboxEvent(context.env, eventId));
}

app.use("*", async (context, next) => {
  const requestId = context.req.header("CF-Ray") || crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Frame-Options", "DENY");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (context.req.path.startsWith("/api/")) context.header("Cache-Control", "no-store");
});

app.use(
  "/api/v1/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (context) =>
      context.json(
        {
          error: {
            code: "REQUEST_TOO_LARGE",
            message: "リクエストが大きすぎます",
            requestId: context.get("requestId"),
          },
        },
        413,
      ),
  }),
);

app.use("/api/v1/*", sessionMiddleware);
app.use("/api/v1/*", rateLimitMiddleware);
app.use("/api/v1/*", csrfMiddleware);

app.get("/api/v1/health/live", (context) => {
  return context.json(data({ status: "ok" }));
});

app.get("/api/v1/health/ready", async (context) => {
  const config = validateConfig(context.env);
  const errors = [...config.errors];
  let embeddingProvider = context.env.EMBEDDING_PROVIDER;
  let embeddingModel = context.env.EMBEDDING_MODEL;
  let embeddingDimensions = Number(context.env.EMBEDDING_DIMENSIONS);
  let embeddingReady = true;
  try {
    const embedding = createEmbeddingProvider(context.env);
    embeddingProvider = embedding.providerId;
    embeddingModel = embedding.model;
    embeddingDimensions = embedding.dimensions ?? embeddingDimensions;
  } catch {
    embeddingReady = false;
    if (!errors.includes("EMBEDDING_PROVIDER_CONFIGURATION_INVALID"))
      errors.push("EMBEDDING_PROVIDER_CONFIGURATION_INVALID");
  }
  let databaseReady = true;
  try {
    await context.env.DB.prepare("SELECT 1 AS ready").first();
  } catch {
    databaseReady = false;
  }
  const ready = errors.length === 0 && databaseReady && embeddingReady;
  return context.json(
    data({
      status: ready ? "ready" : "not_ready",
      environment: context.env.ENVIRONMENT,
      llmProvider: context.env.LLM_PROVIDER,
      embeddingProvider,
      embeddingModel,
      embeddingDimensions,
      checks: { database: databaseReady, configuration: errors.length === 0, embedding: embeddingReady },
      errors,
    }),
    ready ? 200 : 503,
  );
});

app.get("/api/v1/users", async (context) => {
  const query = normalizeUsername(context.req.query("query") ?? "");
  const rows = await all<{ id: string; username: string }>(
    context.env.DB.prepare(
      `SELECT id,username FROM users WHERE status='active' AND is_public=1 AND deleted_at IS NULL AND username_normalized LIKE ? ORDER BY username_normalized,id LIMIT 50`,
    ).bind(`%${query.replace(/[%_]/gu, "")}%`),
  );
  return context.json(data({ users: rows, nextCursor: null }));
});

app.post("/api/v1/users", validateJson(registrationSchema), async (context) => {
  const input = context.req.valid("json");
  await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
  const key = requireIdempotencyKey(context.req.header("Idempotency-Key") || input.idempotencyKey);
  const userId = await deriveUuid(context.env.AUTH_PEPPER, `registration:user:${key}`);
  const accessKey = await deriveUuid(context.env.AUTH_PEPPER, `registration:key:${key}`);
  const username = input.username.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const normalized = normalizeUsername(username);
  const existing = await first<{
    id: string;
    username: string;
    username_normalized: string;
    status: string;
    pending_expires_at: string | null;
  }>(
    context.env.DB.prepare(
      `SELECT id,username,username_normalized,status,pending_expires_at FROM users WHERE id=?`,
    ).bind(userId),
  );
  if (existing) {
    if (existing.username_normalized !== normalized)
      throw new HTTPException(409, { message: "Idempotency-Keyが別のユーザー名で使用されています" });
    return context.json(
      data({
        user: { id: existing.id, username: existing.username, status: existing.status },
        accessKey,
        expiresAt: existing.pending_expires_at,
      }),
      200,
    );
  }
  const duplicate = await first<{ id: string }>(
    context.env.DB.prepare(`SELECT id FROM users WHERE username_normalized=? AND deleted_at IS NULL`).bind(normalized),
  );
  if (duplicate) throw new HTTPException(409, { message: "そのユーザー名は既に使用されています" });
  const now = nowIso();
  const expiresAt = addMinutesIso(15);
  const digest = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(userId, accessKey));
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO users (id,username,username_normalized,status,is_public,pending_expires_at,revision,created_at,updated_at) VALUES (?,?,?,'pending',1,?,1,?,?)`,
    ).bind(userId, username, normalized, expiresAt, now, now),
    context.env.DB.prepare(
      `INSERT INTO credentials (id,user_id,key_generation,key_digest,status,created_at) VALUES (?,?,1,?,'active',?)`,
    ).bind(crypto.randomUUID(), userId, digest, now),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "ユーザーを作成できませんでした" });
  return context.json(data({ user: { id: userId, username, status: "pending" }, accessKey, expiresAt }), 201);
});

app.post("/api/v1/users/:id/activate", validateJson(activationSchema), async (context) => {
  const userId = context.req.param("id");
  const row = await first<{ key_digest: string; status: string; pending_expires_at: string | null; username: string }>(
    context.env.DB.prepare(
      `SELECT c.key_digest,u.status,u.pending_expires_at,u.username FROM users u JOIN credentials c ON c.user_id=u.id AND c.status='active' WHERE u.id=?`,
    ).bind(userId),
  );
  const submitted = await hmacHex(
    context.env.AUTH_PEPPER,
    credentialDigestInput(userId, context.req.valid("json").accessKey),
  );
  if (!row || !constantTimeEqual(row.key_digest, submitted))
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  if (row.status === "active")
    return context.json(data({ user: { id: userId, username: row.username, status: "active" } }));
  if (row.status !== "pending" || !row.pending_expires_at || row.pending_expires_at <= nowIso())
    throw new HTTPException(410, { message: "REGISTRATION_EXPIRED" });
  const now = nowIso();
  await context.env.DB.prepare(
    `UPDATE users SET status='active',activated_at=?,updated_at=?,revision=revision+1 WHERE id=?`,
  )
    .bind(now, now, userId)
    .run();
  return context.json(data({ user: { id: userId, username: row.username, status: "active" } }));
});

app.post("/api/v1/sessions", validateJson(loginSchema), async (context) => {
  const input = context.req.valid("json");
  await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
  const row = await first<{ username: string; key_digest: string; key_generation: number }>(
    context.env.DB.prepare(
      `SELECT u.username,c.key_digest,c.key_generation FROM users u JOIN credentials c ON c.user_id=u.id AND c.status='active' WHERE u.id=? AND u.status='active' AND u.deleted_at IS NULL`,
    ).bind(input.userId),
  );
  const submitted = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(input.userId, input.accessKey));
  if (!row || !constantTimeEqual(row.key_digest, submitted))
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  const token = randomToken(32);
  const csrfToken = await hmacHex(context.env.AUTH_PEPPER, `csrf\u0000${token}`);
  const now = nowIso();
  const days = boundedInteger(context.env.SESSION_DAYS, 30, { max: 90 });
  const expiresAt = addDaysIso(days);
  await context.env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_digest,csrf_digest,credential_generation,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.userId,
      await sha256Hex(token),
      await sha256Hex(csrfToken),
      row.key_generation,
      expiresAt,
      now,
      now,
    )
    .run();
  context.header("Set-Cookie", sessionCookie(token, days * 86_400));
  return context.json(data({ user: { id: input.userId, username: row.username }, csrfToken, expiresAt }));
});

app.delete("/api/v1/sessions", async (context) => {
  const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
  if (token)
    await context.env.DB.prepare(
      `UPDATE sessions SET revoked_at=?,revoke_reason='logout' WHERE token_digest=? AND revoked_at IS NULL`,
    )
      .bind(nowIso(), await sha256Hex(token))
      .run();
  context.header("Set-Cookie", clearSessionCookie());
  return context.body(null, 204);
});

app.get("/api/v1/me", (context) => {
  const session = requireSession(context);
  return context.json(
    data({
      user: { id: session.userId, username: session.username },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }),
  );
});

app.get("/api/v1/entries", async (context) => {
  const session = requireSession(context);
  return context.json(data({ entries: await createDataStoreStrategy(context.env).listEntries(session.userId) }));
});

app.post("/api/v1/identity-candidates", validateJson(identityCandidateRequestSchema), async (context) => {
  const session = requireSession(context);
  const candidates = await createDataStoreStrategy(context.env).listIdentityCandidates(
    session.userId,
    context.req.valid("json"),
  );
  return context.json(data({ candidates }));
});

app.post("/api/v1/entries", validateJson(entrySubmissionSchema), async (context) => {
  const session = requireSession(context);
  const result = await createDataStoreStrategy(context.env).createEntry(
    session.userId,
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
  if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
  return context.json(data(result), 202);
});

app.get("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  const result = await createDataStoreStrategy(context.env).loadEntryReview(session.userId, context.req.param("id"));
  if (!result) throw new HTTPException(404, { message: "キャラクターが見つかりません" });
  return context.json(data(result));
});

app.post("/api/v1/entries/:id/reanalysis", validateJson(entryReanalysisSchema), async (context) => {
  const session = requireSession(context);
  const result = await createDataStoreStrategy(context.env).createEntryReanalysis(
    session.userId,
    context.req.param("id"),
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
  if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
  return context.json(data(result), 202);
});

app.post(
  "/api/v1/understanding-snapshots/:snapshotId/review",
  validateJson(understandingReviewRequestSchema),
  async (context) => {
    const session = requireSession(context);
    const input = context.req.valid("json");
    const snapshotId = context.req.param("snapshotId");
    if ("action" in input) {
      const result = await createDataStoreStrategy(context.env).mutateUnderstandingReview(
        session.userId,
        snapshotId,
        input,
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      return context.json(data(result));
    }
    if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== snapshotId)
      throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
    const result = await createDataStoreStrategy(context.env).confirmUnderstanding(session.userId, input.targetIds[0]);
    dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data({ entryId: result.entryId, status: "analyzing", jobId: result.jobId }), 202);
  },
);

app.post("/api/v1/preference-analysis-runs/:runId/review", validateJson(batchReviewSchema), async (context) => {
  const session = requireSession(context);
  const input = context.req.valid("json");
  const runId = context.req.param("runId");
  if (input.decision === "reject_selected") {
    if (input.targetIds.length !== 1)
      throw new HTTPException(422, { message: "削除する嗜好候補を1件選択してください" });
    const result = await createDataStoreStrategy(context.env).rejectPreferenceAnalysisItem(
      session.userId,
      runId,
      input.targetIds[0],
    );
    return context.json(data(result));
  }
  if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== runId)
    throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
  const result = await createDataStoreStrategy(context.env).activateAnalysisAndRebuild(
    session.userId,
    input.targetIds[0],
  );
  dispatchAfterCommit(context, result.outboxEventId);
  return context.json(data({ status: "active", ...result }), 202);
});

app.delete("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  try {
    const result = await createDataStoreStrategy(context.env).archiveEntry(session.userId, context.req.param("id"));
    dispatchAfterCommit(context, result.outboxEventId);
  } catch (error) {
    if (error instanceof Error && error.message === "ENTRY_NOT_FOUND")
      throw new HTTPException(404, { message: "キャラクターが見つかりません" });
    throw error;
  }
  return context.body(null, 204);
});

app.get("/api/v1/profile", async (context) => {
  const session = requireSession(context);
  const strategy = createDataStoreStrategy(context.env);
  const [profile, freshness] = await Promise.all([
    strategy.loadCurrentProfile(session.userId),
    strategy.loadProjectionFreshness(session.userId),
  ]);
  return context.json(data({ profile, freshness }));
});

app.get("/api/v1/profile/snapshot-items", async (context) => {
  const session = requireSession(context);
  return context.json(data(await createDataStoreStrategy(context.env).loadProfileSnapshotItems(session.userId)));
});

app.get("/api/v1/profile/graph", async (context) => {
  const session = requireSession(context);
  const detail = z.enum(["summary", "standard", "expanded"]).catch("standard").parse(context.req.query("detail"));
  const strategy = createDataStoreStrategy(context.env);
  const [graph, freshness] = await Promise.all([
    strategy.loadCurrentGraph(session.userId, detail),
    strategy.loadProjectionFreshness(session.userId),
  ]);
  return context.json(data({ graph, freshness }));
});

app.post("/api/v1/generation-requests", validateJson(generationRequestInputSchema), async (context) => {
  const session = requireSession(context);
  const result = await createDataStoreStrategy(context.env).createGenerationRequest(
    session.userId,
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.jobId) throw new HTTPException(409, { message: "生成ジョブが見つかりません" });
  if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
  return context.json(data(result), 202);
});

app.get("/api/v1/generated-characters", async (context) => {
  const session = requireSession(context);
  return context.json(
    data({ generations: await createDataStoreStrategy(context.env).listGenerations(session.userId) }),
  );
});

app.delete("/api/v1/generation-requests/:id", async (context) => {
  const session = requireSession(context);
  await createDataStoreStrategy(context.env).deleteGeneration(session.userId, context.req.param("id"));
  return context.body(null, 204);
});

app.get("/api/v1/jobs/:id", async (context) => {
  const session = requireSession(context);
  const job = await createDataStoreStrategy(context.env).loadJob(session.userId, context.req.param("id"));
  if (!job) throw new HTTPException(404, { message: "ジョブが見つかりません" });
  return context.json(data({ job }));
});

app.post("/api/v1/jobs/:id/retry", async (context) => {
  const session = requireSession(context);
  const retryId = requireIdempotencyKey(context.req.header("Idempotency-Key"));
  const strategy = createDataStoreStrategy(context.env);
  const job = await strategy.loadJob(session.userId, context.req.param("id"));
  if (!job) throw new HTTPException(404, { message: "ジョブが見つかりません" });
  const result =
    job.job_type === "generation"
      ? await strategy.retryGeneration(session.userId, context.req.param("id"), retryId)
      : job.job_type === "character_analysis"
        ? await strategy.retryCharacterAnalysis(session.userId, context.req.param("id"), retryId)
        : (() => {
            throw new HTTPException(409, { message: "このジョブ種別は再実行できません" });
          })();
  dispatchAfterCommit(context, result.outboxEventId);
  return context.json(data({ ...result, status: "queued" }), 202);
});

app.post("/api/v1/account/key-rotation", validateJson(keyRotationSchema), async (context) => {
  const session = requireSession(context);
  const active = await first<{ id: string; key_digest: string; key_generation: number }>(
    context.env.DB.prepare(
      `SELECT id,key_digest,key_generation FROM credentials WHERE user_id=? AND status='active'`,
    ).bind(session.userId),
  );
  const submitted = await hmacHex(
    context.env.AUTH_PEPPER,
    credentialDigestInput(session.userId, context.req.valid("json").currentAccessKey),
  );
  if (!active || !constantTimeEqual(active.key_digest, submitted))
    throw new HTTPException(401, { message: "現在のアクセスキーが無効です" });
  const accessKey = crypto.randomUUID();
  const now = nowIso();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE credentials SET status='rotated',rotated_at=? WHERE id=?`).bind(now, active.id),
    context.env.DB.prepare(
      `INSERT INTO credentials (id,user_id,key_generation,key_digest,status,created_at) VALUES (?,?,?,?, 'active',?)`,
    ).bind(
      crypto.randomUUID(),
      session.userId,
      active.key_generation + 1,
      await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(session.userId, accessKey)),
      now,
    ),
    context.env.DB.prepare(
      `UPDATE sessions SET revoked_at=?,revoke_reason='key_rotation' WHERE user_id=? AND revoked_at IS NULL`,
    ).bind(now, session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "アクセスキーを変更できませんでした" });
  context.header("Set-Cookie", clearSessionCookie());
  return context.json(data({ accessKey, sessionsRevoked: true }));
});

app.post("/api/v1/account/exports", validateJson(accountExportRequestSchema), async (context) => {
  const session = requireSession(context);
  const result = await createAccountExport(
    context.env,
    session.userId,
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
  return context.json(data(result), 202);
});

app.get("/api/v1/account/exports/:exportId", async (context) => {
  const session = requireSession(context);
  const result = await first<Record<string, unknown>>(
    context.env.DB.prepare(
      `SELECT id,status,schema_version,byte_size,error_code,created_at,updated_at,completed_at,expires_at
       FROM account_exports WHERE id=? AND owner_user_id=?`,
    ).bind(context.req.param("exportId"), session.userId),
  );
  if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
  return context.json(data({ export: result }));
});

app.get("/api/v1/account/exports/:exportId/download", async (context) => {
  const session = requireSession(context);
  const result = await first<{ status: string; object_key: string | null; expires_at: string | null }>(
    context.env.DB.prepare(
      `SELECT status,object_key,expires_at FROM account_exports WHERE id=? AND owner_user_id=?`,
    ).bind(context.req.param("exportId"), session.userId),
  );
  if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
  if (result.status !== "ready" || !result.object_key)
    throw new HTTPException(result.status === "expired" ? 410 : 409, {
      message: "エクスポートはダウンロードできません",
    });
  if (!result.expires_at || result.expires_at <= nowIso()) throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
  if (!context.env.EXPORTS) throw new HTTPException(503, { message: "エクスポート保存先が利用できません" });
  const object = await context.env.EXPORTS.get(result.object_key);
  if (!object) throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set(
    "Content-Disposition",
    `attachment; filename="character-taste-export-${context.req.param("exportId")}.json"`,
  );
  return new Response(object.body, { headers });
});

app.delete("/api/v1/account", validateJson(accountDeletionSchema), async (context) => {
  const session = requireSession(context);
  if (context.req.valid("json").usernameConfirmation !== session.username)
    throw new HTTPException(422, { message: "確認用ユーザー名が一致しません" });
  if (context.env.EXPORTS) {
    const bucket = context.env.EXPORTS;
    const objects = await all<{ object_key: string | null }>(
      context.env.DB.prepare(`SELECT object_key FROM account_exports WHERE owner_user_id=?`).bind(session.userId),
    );
    await Promise.all(objects.flatMap((item) => (item.object_key ? [bucket.delete(item.object_key)] : [])));
  }
  const results = await context.env.DB.batch([
    // 001_initial.sqlの修正前に作成されたlocal D1でも、jobsのSET NULL/CHECK競合を起こさない。
    context.env.DB.prepare(`DELETE FROM jobs WHERE owner_user_id=?`).bind(session.userId),
    context.env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(session.userId),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "アカウントを削除できませんでした" });
  context.header("Set-Cookie", clearSessionCookie());
  return context.body(null, 204);
});

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  if (error instanceof HTTPException) {
    const explicitCodes = new Set(["ORIGIN_REQUIRED", "ORIGIN_DENIED", "REGISTRATION_EXPIRED", "EXPORT_EXPIRED"]);
    const code = explicitCodes.has(error.message)
      ? error.message
      : error.status === 401
        ? "SESSION_REQUIRED"
        : error.status === 404
          ? "NOT_FOUND"
          : error.status === 409
            ? "CONFLICT"
            : error.status === 429
              ? "RATE_LIMITED"
              : "REQUEST_INVALID";
    const message =
      error.message === "ORIGIN_REQUIRED"
        ? "Originヘッダーが必要です"
        : error.message === "ORIGIN_DENIED"
          ? "許可されていない送信元です"
          : error.message === "REGISTRATION_EXPIRED"
            ? "有効化期限を過ぎています"
            : error.message === "EXPORT_EXPIRED"
              ? "エクスポートの有効期限を過ぎています"
              : error.message;
    return context.json({ error: { code, message, requestId } }, error.status);
  }
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました";
  const known: Record<string, [number, string]> = {
    PROFILE_REQUIRED: [409, "嗜好解析を1件以上確定してから作成してください"],
    PROFILE_ITEM_NOT_FOUND: [404, "選択した嗜好項目が見つかりません"],
    GENERATION_SELECTION_CONFLICT: [422, "同じ項目を採用と禁止の両方には指定できません"],
    UNDERSTANDING_REVIEW_NOT_FOUND: [404, "確認対象が見つかりません"],
    UNDERSTANDING_REVIEW_TARGET_NOT_FOUND: [404, "修正対象が見つかりません"],
    UNDERSTANDING_REVIEW_STATE_CHANGED: [409, "解析内容が更新されました。画面を再読み込みしてください"],
    UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE: [422, "削除する原典設定を特定できません"],
    IDEMPOTENCY_PAYLOAD_MISMATCH: [409, "同じIdempotency-Keyを異なる内容には使用できません"],
    ANALYSIS_JOB_NOT_FOUND: [404, "解析ジョブが見つかりません"],
    JOB_NOT_FAILED: [409, "失敗状態の解析だけ再実行できます"],
    JOB_NOT_RETRYABLE: [409, "この解析エラーは再実行できません"],
    JOB_SUPERSEDED: [409, "古い登録内容の解析は再実行できません"],
    JOB_RETRY_STATE_CHANGED: [409, "解析の状態が更新されました。画面を再読み込みしてください"],
    ENTRY_NOT_FOUND: [404, "キャラクターが見つかりません"],
    ENTRY_ANALYSIS_IN_PROGRESS: [409, "解析中のため、完了後に再分析してください"],
    ENTRY_REANALYSIS_UNAVAILABLE: [409, "この登録は再分析できません"],
    ENTRY_REGISTRATION_TYPE_IMMUTABLE: [422, "再分析では登録方法を変更できません"],
    ENTRY_REVISION_CONFLICT: [409, "登録内容が更新されました。画面を再読み込みしてください"],
    PROFILE_REBUILDING: [409, "プロフィールを再構築しています"],
    PREFERENCE_REVIEW_NOT_FOUND: [404, "確認対象が見つかりません"],
    PREFERENCE_REVIEW_TARGET_NOT_FOUND: [404, "削除する嗜好候補が見つかりません"],
    PREFERENCE_REVIEW_STATE_CHANGED: [409, "嗜好候補が更新されました。画面を再読み込みしてください"],
    IDENTITY_RESOLUTION_INVALID: [422, "選択した同一キャラクター候補を利用できません"],
    GENERATION_JOB_NOT_FOUND: [404, "生成ジョブが見つかりません"],
    GENERATION_NOT_FOUND: [404, "作成履歴が見つかりません"],
    GENERATION_DELETE_IN_PROGRESS: [409, "生成処理が完了してから削除してください"],
    GENERATION_DELETE_STATE_CHANGED: [409, "作成履歴の状態が更新されました。画面を再読み込みしてください"],
    EXPORT_STORAGE_UNAVAILABLE: [503, "エクスポート保存先を利用できません"],
  };
  const mapped = known[message];
  if (mapped) return context.json({ error: { code: message, message: mapped[1], requestId } }, mapped[0] as 404);
  console.error(JSON.stringify({ requestId, code: message.slice(0, 100) }));
  return context.json({ error: { code: "INTERNAL_ERROR", message: "処理を完了できませんでした", requestId } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, executionCtx: ExecutionContext) {
    executionCtx.waitUntil(dispatchPendingOutbox(env, 50));
    if (controller.cron !== "* * * * *") executionCtx.waitUntil(runDailyCleanup(env));
  },
};
