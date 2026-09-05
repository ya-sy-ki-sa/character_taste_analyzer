import { nowIso } from "../../lib/crypto";
import type { Env } from "../../types";
import { expireAccountExports } from "./exports";
import * as repository from "./repositories/cleanup";

export async function runDailyCleanup(env: Env): Promise<void> {
  const now = nowIso();
  const pendingCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await expireAccountExports(env);
  await env.DB.batch([
    repository.deleteUsers(env.DB, [now, pendingCutoff]),
    repository.deleteRequestRateLimits(env.DB, [now]),
    repository.deleteIdempotencyResponses(env.DB, [now]),
    repository.deleteSessions(env.DB, [now, pendingCutoff]),
  ]);
}
