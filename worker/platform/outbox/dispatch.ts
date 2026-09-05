import { nowIso } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/dispatch";

export type OutboxRow = {
  id: string;
  aggregate_id: string;
  payload_json: string;
  attempt_count: number;
};

export async function dispatchOutboxEvent(env: Env, eventId: string, deliver: OutboxDelivery): Promise<boolean> {
  const leaseOwner = crypto.randomUUID();
  const now = nowIso();
  const leaseExpires = new Date(Date.now() + 60_000).toISOString();
  const claim = await repository.updateOutboxEvents(env.DB, [leaseOwner, leaseExpires, eventId, now, now]).run();
  if (!claim.meta.changes) return false;
  const row = await first<OutboxRow>(repository.selectOutboxEvents(env.DB, [eventId, leaseOwner]));
  if (!row) return false;
  try {
    const workflowId = await deliver(env, row);
    const completed = nowIso();
    await env.DB.batch([
      ...(workflowId ? [repository.updateJobs(env.DB, [workflowId, completed, row.aggregate_id])] : []),
      repository.updateOutboxEvents2(env.DB, [completed, eventId, leaseOwner]),
    ]);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 100) : "DISPATCH_FAILED";
    const dead = row.attempt_count >= 10;
    const next = new Date(Date.now() + 60_000).toISOString();
    await env.DB.batch([
      repository.updateOutboxEvents3(env.DB, [dead ? "dead" : "pending", next, code, eventId, leaseOwner]),
      ...(dead ? [repository.updateJobs2(env.DB, [nowIso(), nowIso(), row.aggregate_id])] : []),
    ]);
    return false;
  }
}

export async function dispatchPendingOutbox(env: Env, limit: number, deliver: OutboxDelivery): Promise<number> {
  const rows = await all<{ id: string }>(repository.selectOutboxEvents2(env.DB, [nowIso(), nowIso(), limit]));
  let delivered = 0;
  for (const row of rows) if (await dispatchOutboxEvent(env, row.id, deliver)) delivered += 1;
  return delivered;
}

export async function dispatchPendingProfileRebuild(
  env: Env,
  ownerUserId: string,
  deliver: OutboxDelivery,
): Promise<boolean> {
  const event = await first<{ id: string }>(repository.selectOutboxEvents3(env.DB, [ownerUserId, nowIso(), nowIso()]));
  return event ? dispatchOutboxEvent(env, event.id, deliver) : false;
}

export type OutboxDelivery = (env: Env, row: OutboxRow) => Promise<string | null>;
