import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { readCookie, SESSION_COOKIE, sessionCookie } from "./lib/cookies";
import { addDaysIso, constantTimeEqual, hmacHex, nowIso, sha256Hex } from "./lib/crypto";
import { first } from "./lib/db";
import { boundedInteger } from "./lib/numbers";
import type { AppVariables, Env, Session } from "./types";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
type SessionRow = {
  id: string;
  user_id: string;
  username: string;
  csrf_digest: string;
  expires_at: string;
};

export async function resolveSession(env: Env, cookieHeader?: string): Promise<Session | undefined> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return undefined;
  const tokenDigest = await sha256Hex(token);
  const row = await first<SessionRow>(
    env.DB.prepare(`
      SELECT s.id, s.user_id, u.username, s.csrf_digest, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN credentials c ON c.user_id = u.id
      WHERE s.token_digest = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        AND u.status = 'active'
    `).bind(tokenDigest, nowIso()),
  );
  if (!row) return undefined;
  const csrfToken = await hmacHex(env.AUTH_PEPPER, `csrf\u0000${token}`);
  const csrfDigest = await sha256Hex(csrfToken);
  if (!constantTimeEqual(csrfDigest, row.csrf_digest)) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    csrfToken,
    expiresAt: row.expires_at,
  };
}

export const sessionMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (context, next) => {
  const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
  let session = await resolveSession(context.env, context.req.header("Cookie"));
  if (session && token) {
    const sessionDays = boundedInteger(context.env.SESSION_DAYS, 30, { max: 90 });
    const renewalDays = boundedInteger(context.env.SESSION_RENEWAL_DAYS, 7, { max: sessionDays });
    if (Date.parse(session.expiresAt) - Date.now() <= renewalDays * 86_400_000) {
      const expiresAt = addDaysIso(sessionDays);
      const now = nowIso();
      await context.env.DB.prepare(`
        UPDATE sessions SET expires_at = ?, last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL AND expires_at = ?
      `)
        .bind(expiresAt, now, session.id, session.expiresAt)
        .run();
      context.header("Set-Cookie", sessionCookie(token, sessionDays * 86_400));
      session = { ...session, expiresAt };
    }
    context.set("session", session);
  }
  await next();
});

async function consumeRateLimit(env: Env, scope: string, subject: string, maximum: number, seconds: number) {
  const epoch = Math.floor(Date.now() / 1_000 / seconds) * seconds;
  const bucketKey = await hmacHex(env.AUTH_PEPPER, `rate\u0000${scope}\u0000${subject}\u0000${epoch}`);
  const startedAt = new Date(epoch * 1_000).toISOString();
  const expiresAt = new Date((epoch + seconds * 2) * 1_000).toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO request_rate_limits (bucket_key, window_started_at, request_count, expires_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
    RETURNING request_count AS count
  `)
    .bind(bucketKey, startedAt, expiresAt, nowIso())
    .first<{ count: number }>();
  if ((result?.count ?? 0) > maximum) throw new HTTPException(429, { message: "短時間にリクエストが集中しています" });
}

export const rateLimitMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (context, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return next();
    const ip = context.req.header("CF-Connecting-IP") || context.req.header("X-Real-IP") || "local";
    const session = context.get("session");
    if (session) {
      await Promise.all([
        consumeRateLimit(context.env, "ip", ip, boundedInteger(context.env.IP_WRITE_LIMIT_PER_MIN, 120), 60),
        consumeRateLimit(
          context.env,
          "user",
          session.userId,
          boundedInteger(context.env.USER_WRITE_LIMIT_PER_MIN, 60),
          60,
        ),
      ]);
    } else {
      await consumeRateLimit(context.env, "public", ip, boundedInteger(context.env.PUBLIC_WRITE_LIMIT_10_MIN, 30), 600);
    }
    await next();
  },
);

export function requireSession(context: AppContext): Session {
  const session = context.get("session");
  if (!session) throw new HTTPException(401, { message: "ログインが必要です" });
  return session;
}

export const csrfMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (context, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return next();
  const origin = context.req.header("Origin");
  const expected = context.env.APP_ORIGIN || new URL(context.req.url).origin;
  if (!origin) throw new HTTPException(403, { message: "ORIGIN_REQUIRED" });
  if (origin !== expected) throw new HTTPException(403, { message: "ORIGIN_DENIED" });
  const session = context.get("session");
  if (session) {
    const csrf = context.req.header("X-CSRF-Token");
    if (!csrf || !constantTimeEqual(csrf, session.csrfToken))
      throw new HTTPException(403, { message: "セキュリティトークンが無効です" });
  }
  await next();
});

export async function verifyTurnstile(env: Env, token?: string, remoteIp?: string): Promise<void> {
  if (env.ENVIRONMENT === "local" && (env.LLM_PROVIDER === "replay" || env.LLM_PROVIDER === "fake")) return;
  if (!env.TURNSTILE_SECRET) {
    if (env.ENVIRONMENT === "production") throw new HTTPException(503, { message: "Turnstileが設定されていません" });
    return;
  }
  if (!token) throw new HTTPException(400, { message: "ボット確認を完了してください" });
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json<{ success: boolean }>();
  if (!result.success) throw new HTTPException(400, { message: "ボット確認に失敗しました" });
}

export async function enforceQuota(env: Env, userId: string, capability: "analysis" | "generation"): Promise<void> {
  const date = nowIso().slice(0, 10);
  const limit = boundedInteger(
    capability === "analysis" ? env.ANALYSIS_DAILY_QUOTA : env.GENERATION_DAILY_QUOTA,
    capability === "analysis" ? 30 : 10,
  );
  const result = await env.DB.prepare(`
    INSERT INTO usage_daily (usage_date, user_id, capability, accepted_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(usage_date, user_id, capability)
    DO UPDATE SET accepted_count = accepted_count + 1, updated_at = excluded.updated_at
    RETURNING accepted_count AS count
  `)
    .bind(date, userId, capability, nowIso())
    .first<{ count: number }>();
  if ((result?.count ?? 0) > limit) {
    await env.DB.prepare(
      `UPDATE usage_daily SET accepted_count = accepted_count - 1, rejected_count = rejected_count + 1 WHERE usage_date = ? AND user_id = ? AND capability = ?`,
    )
      .bind(date, userId, capability)
      .run();
    throw new HTTPException(429, { message: `本日の${capability === "analysis" ? "解析" : "生成"}上限に達しました` });
  }
}
