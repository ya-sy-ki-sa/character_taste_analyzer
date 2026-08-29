import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { readCookie, SESSION_COOKIE, sessionCookie } from "./lib/cookies";
import { addDaysIso, constantTimeEqual, hmacHex, sha256Hex } from "./lib/crypto";
import { first, run } from "./lib/db";
import { boundedInteger } from "./lib/numbers";
import type { AppVariables, Env, Session } from "./types";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

type SessionRow = {
  user_id: string;
  username: string;
  csrf_digest_hex: string;
  expires_at: string;
};

export async function resolveSession(
  env: Env,
  cookieHeader?: string,
  includeRevoked = false,
): Promise<Session | undefined> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return undefined;
  const tokenDigest = await sha256Hex(token);
  const row = await first<SessionRow>(
    env.DB.prepare(`
    SELECT s.user_id, u.username, s.csrf_digest_hex, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_digest_hex = ? AND (? = 1 OR s.revoked_at IS NULL)
      AND s.expires_at > ? AND u.status = 'active'
  `).bind(tokenDigest, includeRevoked ? 1 : 0, new Date().toISOString()),
  );
  if (!row) return undefined;
  const csrfToken = await hmacHex(env.AUTH_PEPPER, `csrf\u0000${token}`);
  const csrfDigest = await sha256Hex(csrfToken);
  if (!constantTimeEqual(csrfDigest, row.csrf_digest_hex)) {
    await run(
      env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_digest_hex = ?").bind(
        new Date().toISOString(),
        tokenDigest,
      ),
    );
    return undefined;
  }
  return { userId: row.user_id, username: row.username, csrfToken, expiresAt: row.expires_at };
}

export const sessionMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (context, next) => {
  const cookieHeader = context.req.header("Cookie");
  let session = await resolveSession(context.env, cookieHeader);
  if (session) {
    const sessionDays = boundedInteger(context.env.SESSION_DAYS, 30);
    const renewalDays = boundedInteger(context.env.SESSION_RENEWAL_DAYS, 7, { max: sessionDays });
    const remainingMs = Date.parse(session.expiresAt) - Date.now();
    if (remainingMs <= renewalDays * 86_400_000) {
      const token = readCookie(cookieHeader, SESSION_COOKIE);
      if (token) {
        const expiresAt = addDaysIso(sessionDays);
        await run(
          context.env.DB.prepare(`
          UPDATE sessions SET expires_at = ?
          WHERE token_digest_hex = ? AND revoked_at IS NULL
        `).bind(expiresAt, await sha256Hex(token)),
        );
        context.header("Set-Cookie", sessionCookie(token, sessionDays * 86_400));
        session = { ...session, expiresAt };
      }
    }
    context.set("session", session);
  }
  await next();
});

async function consumeRateLimit(env: Env, scope: string, subject: string, maximum: number, windowSeconds: number) {
  const windowStart = Math.floor(Date.now() / 1_000 / windowSeconds) * windowSeconds;
  const subjectDigest = await hmacHex(env.AUTH_PEPPER, `rate-limit\u0000${scope}\u0000${subject}`);
  const result = await env.DB.prepare(`
    INSERT INTO request_rate_limits (scope, subject_digest, window_start, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, subject_digest, window_start)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count AS count
  `)
    .bind(scope, subjectDigest, windowStart)
    .first<{ count: number }>();
  if ((result?.count ?? 0) > maximum)
    throw new HTTPException(429, { message: "短時間にリクエストが集中しています。しばらく待ってください" });
}

export const rateLimitMiddleware = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (context, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      await next();
      return;
    }
    const ip = context.req.header("CF-Connecting-IP") || context.req.header("X-Real-IP") || "local-or-unknown";
    const session = context.get("session");
    if (session) {
      await Promise.all([
        consumeRateLimit(
          context.env,
          "authenticated-ip-minute",
          ip,
          boundedInteger(context.env.IP_WRITE_LIMIT_PER_MIN, 120),
          60,
        ),
        consumeRateLimit(
          context.env,
          "authenticated-user-minute",
          session.userId,
          boundedInteger(context.env.USER_WRITE_LIMIT_PER_MIN, 60),
          60,
        ),
      ]);
    } else {
      await consumeRateLimit(
        context.env,
        "public-ip-ten-minutes",
        ip,
        boundedInteger(context.env.PUBLIC_WRITE_LIMIT_10_MIN, 30),
        600,
      );
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
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    await next();
    return;
  }
  // Origin checking protects both authenticated mutations and public account/login
  // endpoints. Browsers always send Origin for cross-origin fetches and form posts.
  const origin = context.req.header("Origin");
  const expectedOrigin = context.env.APP_ORIGIN || new URL(context.req.url).origin;
  if (origin && origin !== expectedOrigin) throw new HTTPException(403, { message: "許可されていない送信元です" });
  const session = context.get("session");
  if (!session) {
    await next();
    return;
  }
  const csrf = context.req.header("X-CSRF-Token");
  if (!csrf || !constantTimeEqual(csrf, session.csrfToken)) {
    throw new HTTPException(403, { message: "セキュリティトークンが無効です" });
  }
  await next();
});

export async function verifyTurnstile(env: Env, token: string | undefined, remoteIp?: string): Promise<void> {
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

export async function enforceQuota(
  env: Env,
  userId: string,
  kind: "analysis" | "generation" | "recommendation",
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const quotas = {
    analysis: { value: env.ANALYSIS_DAILY_QUOTA, fallback: 30, column: "analysis_count", label: "分析" },
    generation: { value: env.GENERATION_DAILY_QUOTA, fallback: 10, column: "generation_count", label: "生成" },
    recommendation: {
      value: env.RECOMMENDATION_DAILY_QUOTA,
      fallback: 20,
      column: "recommendation_count",
      label: "候補表示",
    },
  } as const;
  const selected = quotas[kind];
  const limit = boundedInteger(selected.value, selected.fallback);
  const column = selected.column;
  const result = await env.DB.prepare(`
    INSERT INTO usage_daily (user_id, usage_date, ${column}) VALUES (?, ?, 1)
    ON CONFLICT(user_id, usage_date) DO UPDATE SET ${column} = ${column} + 1
    RETURNING ${column} AS count
  `)
    .bind(userId, date)
    .first<{ count: number }>();
  if ((result?.count ?? 0) > limit) {
    await env.DB.prepare(`UPDATE usage_daily SET ${column} = ${column} - 1 WHERE user_id = ? AND usage_date = ?`)
      .bind(userId, date)
      .run();
    throw new HTTPException(429, { message: `本日の${selected.label}上限に達しました` });
  }
}
