import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { activationSchema, loginSchema, registrationSchema } from "../../../shared/contracts/account";
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
} from "../../lib/crypto";
import { first } from "../../lib/db";
import { boundedInteger } from "../../lib/numbers";
import type { Env } from "../../types";
import { membershipTierForUser } from "./membership";
import * as repository from "./repositories/authentication";
export async function registerAccount(env: Env, input: z.output<typeof registrationSchema>, key: string) {
  const userId = await deriveUuid(env.AUTH_PEPPER, `registration:user:${key}`);
  const accessKey = await deriveUuid(env.AUTH_PEPPER, `registration:key:${key}`);
  const username = input.username.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const normalized = normalizeUsername(username);
  const existing = await first<{
    id: string;
    username: string;
    username_normalized: string;
    membership_tier: string;
    status: string;
    pending_expires_at: string | null;
  }>(repository.selectUsers(env.DB, [userId]));
  if (existing) {
    if (existing.username_normalized !== normalized)
      throw new HTTPException(409, { message: "Idempotency-Keyが別のユーザー名で使用されています" });
    return {
      result: {
        user: {
          id: existing.id,
          username: existing.username,
          status: existing.status,
          membershipTier: membershipTierForUser(existing),
        },
        accessKey,
        expiresAt: existing.pending_expires_at,
      },
      status: 200 as const,
    };
  }
  const duplicate = await first<{ id: string }>(repository.selectUsers2(env.DB, [normalized]));
  if (duplicate) throw new HTTPException(409, { message: "そのユーザー名は既に使用されています" });
  const now = nowIso();
  const expiresAt = addMinutesIso(15);
  const digest = await hmacHex(env.AUTH_PEPPER, credentialDigestInput(userId, accessKey));
  const results = await env.DB.batch([
    repository.insertUsers(env.DB, [userId, username, normalized, expiresAt, now, now]),
    repository.insertCredentials(env.DB, [userId, digest, now]),
  ]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "ユーザーを作成できませんでした" });
  return {
    result: { user: { id: userId, username, status: "pending", membershipTier: "basic" }, accessKey, expiresAt },
    status: 201 as const,
  };
}

export async function activateAccount(env: Env, userId: string, input: z.output<typeof activationSchema>) {
  const row = await first<{
    key_digest: string;
    status: string;
    pending_expires_at: string | null;
    username: string;
    membership_tier: string;
  }>(repository.selectUsers3(env.DB, [userId]));
  const submitted = await hmacHex(env.AUTH_PEPPER, credentialDigestInput(userId, input.accessKey));
  if (!row || !constantTimeEqual(row.key_digest, submitted))
    throw new HTTPException(401, { message: "ユーザーIDまたはアクセスキーが無効です" });
  if (row.status === "active")
    return {
      user: {
        id: userId,
        username: row.username,
        status: "active",
        membershipTier: membershipTierForUser(row),
      },
    };
  if (row.status !== "pending" || !row.pending_expires_at || row.pending_expires_at <= nowIso())
    throw new HTTPException(410, { message: "REGISTRATION_EXPIRED" });
  const now = nowIso();
  await repository.updateUsers(env.DB, [now, now, userId]).run();
  return {
    user: { id: userId, username: row.username, status: "active", membershipTier: membershipTierForUser(row) },
  };
}

export async function startSession(env: Env, input: z.output<typeof loginSchema>) {
  const row = await first<{ id: string; username: string; key_digest: string; membership_tier: string }>(
    repository.selectUsers4(env.DB, [normalizeUsername(input.username)]),
  );
  const submitted = await hmacHex(
    env.AUTH_PEPPER,
    credentialDigestInput(row?.id ?? "00000000-0000-0000-0000-000000000000", input.accessKey),
  );
  if (!row || !constantTimeEqual(row.key_digest, submitted))
    throw new HTTPException(401, { message: "ユーザー名またはログインキーが無効です" });
  const token = randomToken(32);
  const csrfToken = await hmacHex(env.AUTH_PEPPER, `csrf\u0000${token}`);
  const now = nowIso();
  const days = boundedInteger(env.SESSION_DAYS, 30, { max: 90 });
  const expiresAt = addDaysIso(days);
  await repository
    .insertSessions(env.DB, [
      crypto.randomUUID(),
      row.id,
      await sha256Hex(token),
      await sha256Hex(csrfToken),
      expiresAt,
      now,
      now,
    ])
    .run();

  return {
    result: {
      user: { id: row.id, username: row.username, membershipTier: membershipTierForUser(row) },
      csrfToken,
      expiresAt,
    },
    token,
    maxAge: days * 86_400,
  };
}

export async function endSession(env: Env, token?: string) {
  if (token) await repository.updateSessions(env.DB, [nowIso(), await sha256Hex(token)]).run();
}
