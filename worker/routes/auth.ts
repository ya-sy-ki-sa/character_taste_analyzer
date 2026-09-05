import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { activationSchema, loginSchema, registrationSchema } from "../../shared/schemas";
import { requireSession, verifyTurnstile } from "../auth";
import { data, requireIdempotencyKey, validateJson } from "../http";
import { clearSessionCookie, readSessionCookie, sessionCookie } from "../lib/cookies";
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
} from "../lib/crypto";
import { first } from "../lib/db";
import { boundedInteger } from "../lib/numbers";
import type { AppEnv } from "../types";

export function createAuthRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/users", validateJson(registrationSchema), async (context) => {
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
      context.env.DB.prepare(`SELECT id FROM users WHERE username_normalized=?`).bind(normalized),
    );
    if (duplicate) throw new HTTPException(409, { message: "そのユーザー名は既に使用されています" });
    const now = nowIso();
    const expiresAt = addMinutesIso(15);
    const digest = await hmacHex(context.env.AUTH_PEPPER, credentialDigestInput(userId, accessKey));
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO users (id,username,username_normalized,status,is_public,pending_expires_at,created_at,updated_at) VALUES (?,?,?,'pending',1,?,?,?)`,
      ).bind(userId, username, normalized, expiresAt, now, now),
      context.env.DB.prepare(`INSERT INTO credentials (user_id,key_digest,created_at) VALUES (?,?,?)`).bind(
        userId,
        digest,
        now,
      ),
    ]);
    if (results.some((result) => !result.success))
      throw new HTTPException(500, { message: "ユーザーを作成できませんでした" });
    return context.json(data({ user: { id: userId, username, status: "pending" }, accessKey, expiresAt }), 201);
  });

  app.post("/users/:id/activate", validateJson(activationSchema), async (context) => {
    const userId = context.req.param("id");
    const row = await first<{
      key_digest: string;
      status: string;
      pending_expires_at: string | null;
      username: string;
    }>(
      context.env.DB.prepare(
        `SELECT c.key_digest,u.status,u.pending_expires_at,u.username FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.id=?`,
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
    await context.env.DB.prepare(`UPDATE users SET status='active',activated_at=?,updated_at=? WHERE id=?`)
      .bind(now, now, userId)
      .run();
    return context.json(data({ user: { id: userId, username: row.username, status: "active" } }));
  });

  app.post("/sessions", validateJson(loginSchema), async (context) => {
    const input = context.req.valid("json");
    await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
    const row = await first<{ id: string; username: string; key_digest: string }>(
      context.env.DB.prepare(
        `SELECT u.id,u.username,c.key_digest FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.username_normalized=? AND u.status='active'`,
      ).bind(normalizeUsername(input.username)),
    );
    const submitted = await hmacHex(
      context.env.AUTH_PEPPER,
      credentialDigestInput(row?.id ?? "00000000-0000-0000-0000-000000000000", input.accessKey),
    );
    if (!row || !constantTimeEqual(row.key_digest, submitted))
      throw new HTTPException(401, { message: "ユーザー名またはログインキーが無効です" });
    const token = randomToken(32);
    const csrfToken = await hmacHex(context.env.AUTH_PEPPER, `csrf\u0000${token}`);
    const now = nowIso();
    const days = boundedInteger(context.env.SESSION_DAYS, 30, { max: 90 });
    const expiresAt = addDaysIso(days);
    await context.env.DB.prepare(
      `INSERT INTO sessions (id,user_id,token_digest,csrf_digest,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(crypto.randomUUID(), row.id, await sha256Hex(token), await sha256Hex(csrfToken), expiresAt, now, now)
      .run();
    context.header("Set-Cookie", sessionCookie(token, days * 86_400, context.env.ENVIRONMENT));
    return context.json(data({ user: { id: row.id, username: row.username }, csrfToken, expiresAt }));
  });

  app.delete("/sessions", async (context) => {
    const token = readSessionCookie(context.req.header("Cookie"), context.env.ENVIRONMENT);
    if (token)
      await context.env.DB.prepare(
        `UPDATE sessions SET revoked_at=?,revoke_reason='logout' WHERE token_digest=? AND revoked_at IS NULL`,
      )
        .bind(nowIso(), await sha256Hex(token))
        .run();
    context.header("Set-Cookie", clearSessionCookie(context.env.ENVIRONMENT));
    return context.body(null, 204);
  });

  app.get("/me", (context) => {
    const session = requireSession(context);
    return context.json(
      data({
        user: { id: session.userId, username: session.username },
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      }),
    );
  });

  return app;
}
