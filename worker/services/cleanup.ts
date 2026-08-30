import { nowIso } from "../lib/crypto";
import type { Env } from "../types";
import { expireAccountExports } from "./exports";

export async function runDailyCleanup(env: Env): Promise<void> {
  const now = nowIso();
  const pendingCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await expireAccountExports(env);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM users WHERE status='pending' AND pending_expires_at<? AND pending_expires_at<?`).bind(
      now,
      pendingCutoff,
    ),
    env.DB.prepare(`DELETE FROM request_rate_limits WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM idempotency_responses WHERE expires_at<?`).bind(now),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)`).bind(
      now,
      pendingCutoff,
    ),
  ]);
}
