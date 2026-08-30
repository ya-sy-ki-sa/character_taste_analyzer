import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  accountDeletionSchema,
  activationSchema,
  batchReviewSchema,
  entryDraftSchema,
  entryReanalysisSchema,
  generationRequestInputSchema,
  keyRotationSchema,
  loginSchema,
  registrationSchema,
} from "../shared/schemas";
import {
  csrfMiddleware,
  enforceQuota,
  rateLimitMiddleware,
  requireSession,
  sessionMiddleware,
  verifyTurnstile,
} from "./auth";
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
import { createDataStoreStrategy } from "./storage/strategy";
import type { AppVariables, CharacterAnalysisWorkflowParams, Env, GenerationWorkflowParams } from "./types";

export { CharacterAnalysisWorkflow, GenerationWorkflow } from "./workflows";

type AppEnv = { Bindings: Env; Variables: AppVariables };
const app = new Hono<AppEnv>();

function data<T>(value: T) {
  return { data: value };
}

function requireIdempotencyKey(value?: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Idempotency-KeyにはUUIDが必要です" });
  return parsed.data;
}

async function startAnalysis(
  context: Parameters<typeof requireSession>[0],
  params: CharacterAnalysisWorkflowParams,
  runId?: string,
) {
  if (context.env.CHARACTER_ANALYSIS_WORKFLOW) {
    const instance = await context.env.CHARACTER_ANALYSIS_WORKFLOW.create({
      id: `analysis-${params.jobId}-${params.stage}${runId ? `-${runId}` : ""}`,
      params,
    });
    await context.env.DB.prepare(`UPDATE jobs SET workflow_instance_id=? WHERE id=?`)
      .bind(instance.id, params.jobId)
      .run();
    return;
  }
  context.executionCtx.waitUntil(
    params.stage === "understanding"
      ? createDataStoreStrategy(context.env).processCharacterAnalysis(params)
      : createDataStoreStrategy(context.env).processPreferenceAnalysis(params),
  );
}

async function startGeneration(context: Parameters<typeof requireSession>[0], params: GenerationWorkflowParams) {
  if (context.env.GENERATION_WORKFLOW) {
    const instance = await context.env.GENERATION_WORKFLOW.create({ id: `generation-${params.jobId}`, params });
    await context.env.DB.prepare(`UPDATE jobs SET workflow_instance_id=? WHERE id=?`)
      .bind(instance.id, params.jobId)
      .run();
    return;
  }
  context.executionCtx.waitUntil(createDataStoreStrategy(context.env).processGeneration(params));
}

app.use("*", async (context, next) => {
  const requestId = context.req.header("CF-Ray") || crypto.randomUUID();
  context.set("requestId", requestId);
  if (Number(context.req.header("Content-Length") || 0) > 64_000)
    throw new HTTPException(413, { message: "リクエストが大きすぎます" });
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

app.use("/api/v1/*", sessionMiddleware);
app.use("/api/v1/*", rateLimitMiddleware);
app.use("/api/v1/*", csrfMiddleware);

app.get("/api/v1/health", (context) => {
  const embedding = createEmbeddingProvider(context.env);
  return context.json(
    data({
      status: "ok",
      environment: context.env.ENVIRONMENT,
      llmProvider: context.env.LLM_PROVIDER,
      embeddingProvider: embedding.providerId,
      embeddingModel: embedding.model,
      embeddingDimensions: embedding.dimensions,
    }),
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

app.post("/api/v1/users", zValidator("json", registrationSchema), async (context) => {
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

app.post("/api/v1/users/:id/activate", zValidator("json", activationSchema), async (context) => {
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
    throw new HTTPException(401, { message: "有効化期限を過ぎています" });
  const now = nowIso();
  await context.env.DB.prepare(
    `UPDATE users SET status='active',activated_at=?,updated_at=?,revision=revision+1 WHERE id=?`,
  )
    .bind(now, now, userId)
    .run();
  return context.json(data({ user: { id: userId, username: row.username, status: "active" } }));
});

app.post("/api/v1/sessions", zValidator("json", loginSchema), async (context) => {
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

app.post("/api/v1/entries", zValidator("json", entryDraftSchema), async (context) => {
  const session = requireSession(context);
  await enforceQuota(context.env, session.userId, "analysis");
  const result = await createDataStoreStrategy(context.env).createEntry(
    session.userId,
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.replayed)
    await startAnalysis(context, {
      jobId: result.jobId,
      ownerUserId: session.userId,
      entryId: result.entryId,
      stage: "understanding",
    });
  return context.json(data(result), 202);
});

app.get("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  const result = await createDataStoreStrategy(context.env).loadEntryReview(session.userId, context.req.param("id"));
  if (!result) throw new HTTPException(404, { message: "キャラクターが見つかりません" });
  return context.json(data(result));
});

app.post("/api/v1/entries/:id/reanalysis", zValidator("json", entryReanalysisSchema), async (context) => {
  const session = requireSession(context);
  await enforceQuota(context.env, session.userId, "analysis");
  const result = await createDataStoreStrategy(context.env).createEntryReanalysis(
    session.userId,
    context.req.param("id"),
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.replayed)
    await startAnalysis(context, {
      jobId: result.jobId,
      ownerUserId: session.userId,
      entryId: result.entryId,
      stage: "understanding",
    });
  return context.json(data(result), 202);
});

app.post("/api/v1/entries/:id/understanding-review", zValidator("json", batchReviewSchema), async (context) => {
  const session = requireSession(context);
  const input = context.req.valid("json");
  if (input.decision !== "confirm_all" || input.targetIds.length !== 1)
    throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
  await createDataStoreStrategy(context.env).confirmUnderstanding(
    session.userId,
    context.req.param("id"),
    input.targetIds[0],
  );
  const job = await first<{ id: string }>(
    context.env.DB.prepare(
      `SELECT id FROM jobs WHERE owner_user_id=? AND target_type='entry' AND target_id=? ORDER BY created_at DESC LIMIT 1`,
    ).bind(session.userId, context.req.param("id")),
  );
  if (!job) throw new HTTPException(409, { message: "解析ジョブが見つかりません" });
  await startAnalysis(context, {
    jobId: job.id,
    ownerUserId: session.userId,
    entryId: context.req.param("id"),
    stage: "preference",
  });
  return context.json(data({ entryId: context.req.param("id"), status: "analyzing", jobId: job.id }), 202);
});

app.post("/api/v1/entries/:id/preference-review", zValidator("json", batchReviewSchema), async (context) => {
  const session = requireSession(context);
  const input = context.req.valid("json");
  if (input.decision !== "confirm_all" || input.targetIds.length !== 1)
    throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
  const result = await createDataStoreStrategy(context.env).activateAnalysisAndRebuild(
    session.userId,
    context.req.param("id"),
    input.targetIds[0],
  );
  return context.json(data({ entryId: context.req.param("id"), status: "active", ...result }));
});

app.delete("/api/v1/entries/:id", async (context) => {
  const session = requireSession(context);
  try {
    await createDataStoreStrategy(context.env).archiveEntry(session.userId, context.req.param("id"));
  } catch (error) {
    if (error instanceof Error && error.message === "ENTRY_NOT_FOUND")
      throw new HTTPException(404, { message: "キャラクターが見つかりません" });
    throw error;
  }
  return context.body(null, 204);
});

app.get("/api/v1/profile", async (context) => {
  const session = requireSession(context);
  return context.json(data({ profile: await createDataStoreStrategy(context.env).loadCurrentProfile(session.userId) }));
});

app.get("/api/v1/profile/snapshot-items", async (context) => {
  const session = requireSession(context);
  return context.json(data(await createDataStoreStrategy(context.env).loadProfileSnapshotItems(session.userId)));
});

app.get("/api/v1/profile/graph", async (context) => {
  const session = requireSession(context);
  const detail = z.enum(["summary", "standard", "expanded"]).catch("standard").parse(context.req.query("detail"));
  return context.json(
    data({ graph: await createDataStoreStrategy(context.env).loadCurrentGraph(session.userId, detail) }),
  );
});

app.post("/api/v1/generation-requests", zValidator("json", generationRequestInputSchema), async (context) => {
  const session = requireSession(context);
  await enforceQuota(context.env, session.userId, "generation");
  const result = await createDataStoreStrategy(context.env).createGenerationRequest(
    session.userId,
    context.req.valid("json"),
    requireIdempotencyKey(context.req.header("Idempotency-Key")),
  );
  if (!result.jobId) throw new HTTPException(409, { message: "生成ジョブが見つかりません" });
  if (!result.replayed)
    await startGeneration(context, {
      jobId: result.jobId,
      ownerUserId: session.userId,
      generationRequestId: result.generationRequestId,
    });
  return context.json(data(result), 202);
});

app.get("/api/v1/generated-characters", async (context) => {
  const session = requireSession(context);
  return context.json(
    data({ generations: await createDataStoreStrategy(context.env).listGenerations(session.userId) }),
  );
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
  const result = await createDataStoreStrategy(context.env).retryCharacterAnalysis(
    session.userId,
    context.req.param("id"),
  );
  await startAnalysis(
    context,
    {
      jobId: result.jobId,
      ownerUserId: session.userId,
      entryId: result.entryId,
      stage: result.stage,
    },
    retryId,
  );
  return context.json(data({ ...result, status: "queued" }), 202);
});

app.post("/api/v1/account/key-rotation", zValidator("json", keyRotationSchema), async (context) => {
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

app.get("/api/v1/account/export", async (context) => {
  const session = requireSession(context);
  const [entries, profile, generations] = await Promise.all([
    createDataStoreStrategy(context.env).listEntries(session.userId),
    createDataStoreStrategy(context.env).loadCurrentProfile(session.userId),
    createDataStoreStrategy(context.env).listGenerations(session.userId),
  ]);
  return context.json({
    schemaVersion: "1.0",
    exportedAt: nowIso(),
    user: { id: session.userId, username: session.username },
    entries,
    profile,
    generations,
  });
});

app.delete("/api/v1/account", zValidator("json", accountDeletionSchema), async (context) => {
  const session = requireSession(context);
  if (context.req.valid("json").usernameConfirmation !== session.username)
    throw new HTTPException(422, { message: "確認用ユーザー名が一致しません" });
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
    const code =
      error.status === 401
        ? "session_required"
        : error.status === 404
          ? "not_found"
          : error.status === 409
            ? "conflict"
            : error.status === 429
              ? "rate_limited"
              : "request_invalid";
    return context.json({ error: { code, message: error.message, requestId } }, error.status);
  }
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました";
  const known: Record<string, [number, string]> = {
    PROFILE_REQUIRED: [409, "嗜好解析を1件以上確定してから作成してください"],
    PROFILE_ITEM_NOT_FOUND: [404, "選択した嗜好項目が見つかりません"],
    GENERATION_SELECTION_CONFLICT: [422, "同じ項目を採用と禁止の両方には指定できません"],
    UNDERSTANDING_REVIEW_NOT_FOUND: [404, "確認対象が見つかりません"],
    IDEMPOTENCY_PAYLOAD_MISMATCH: [409, "同じIdempotency-Keyを異なる内容には使用できません"],
    ANALYSIS_JOB_NOT_FOUND: [404, "解析ジョブが見つかりません"],
    JOB_NOT_FAILED: [409, "失敗状態の解析だけ再実行できます"],
    JOB_NOT_RETRYABLE: [409, "この解析エラーは再実行できません"],
    JOB_SUPERSEDED: [409, "古い登録内容の解析は再実行できません"],
    JOB_RETRY_STATE_CHANGED: [409, "解析の状態が更新されました。画面を再読み込みしてください"],
    ENTRY_NOT_FOUND: [404, "キャラクターが見つかりません"],
    ENTRY_ANALYSIS_IN_PROGRESS: [409, "解析中のため、完了後に再分析してください"],
    ENTRY_REANALYSIS_UNAVAILABLE: [409, "この登録は再分析できません"],
    ENTRY_REVISION_CONFLICT: [409, "登録内容が更新されました。画面を再読み込みしてください"],
  };
  const mapped = known[message];
  if (mapped)
    return context.json(
      { error: { code: message.toLocaleLowerCase(), message: mapped[1], requestId } },
      mapped[0] as 404,
    );
  console.error(JSON.stringify({ requestId, code: message.slice(0, 100) }));
  return context.json({ error: { code: "internal_error", message: "処理を完了できませんでした", requestId } }, 500);
});

export default app;
