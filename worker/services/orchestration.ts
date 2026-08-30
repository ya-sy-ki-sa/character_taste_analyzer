import { nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type {
  CharacterAnalysisWorkflowParams,
  Env,
  ExportWorkflowParams,
  GenerationWorkflowParams,
  ProfileRebuildWorkflowParams,
} from "../types";

export type OutboxPayload =
  | { type: "analysis.start"; params: CharacterAnalysisWorkflowParams }
  | { type: "generation.start"; params: GenerationWorkflowParams }
  | { type: "profile.rebuild"; params: ProfileRebuildWorkflowParams }
  | { type: "export.start"; params: ExportWorkflowParams };

export async function outboxStatement(
  env: Env,
  ownerUserId: string,
  aggregateType: string,
  aggregateId: string,
  aggregateRevision: number,
  payload: OutboxPayload,
  deduplicationKey: string,
  correlationId: string,
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const now = nowIso();
  return {
    id,
    statement: env.DB.prepare(
      `INSERT INTO outbox_events
        (id,owner_user_id,aggregate_type,aggregate_id,aggregate_revision,event_type,event_version,
         payload_json,payload_hash,correlation_id,deduplication_key,status,attempt_count,available_at,created_at)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,'pending',0,?,?)`,
    ).bind(
      id,
      ownerUserId,
      aggregateType,
      aggregateId,
      aggregateRevision,
      payload.type,
      payloadJson,
      await sha256Hex(payloadJson),
      correlationId,
      deduplicationKey,
      now,
      now,
    ),
  };
}

type OutboxRow = {
  id: string;
  aggregate_id: string;
  payload_json: string;
  attempt_count: number;
};

type WorkflowBinding<Params> = {
  create(options: { id: string; params: Params }): Promise<{ id: string }>;
  get(id: string): Promise<{ id: string }>;
};

export function workflowInstanceIdForEvent(eventId: string, type: OutboxPayload["type"]): string {
  const prefix =
    type === "analysis.start"
      ? "analysis"
      : type === "generation.start"
        ? "generation"
        : type === "profile.rebuild"
          ? "profile"
          : "export";
  return `${prefix}-${eventId}`;
}

async function createOrGetWorkflow<Params>(
  workflow: WorkflowBinding<Params>,
  id: string,
  params: Params,
): Promise<string> {
  try {
    return (await workflow.create({ id, params })).id;
  } catch (createError) {
    try {
      return (await workflow.get(id)).id;
    } catch {
      throw createError;
    }
  }
}

async function deliver(env: Env, row: OutboxRow): Promise<string | null> {
  const payload = JSON.parse(row.payload_json) as OutboxPayload;
  if (payload.type === "analysis.start") {
    if (!env.CHARACTER_ANALYSIS_WORKFLOW) {
      const { createDataStoreStrategy } = await import("../storage/strategy");
      const strategy = createDataStoreStrategy(env);
      if (payload.params.stage === "understanding") await strategy.processCharacterAnalysis(payload.params);
      else await strategy.processPreferenceAnalysis(payload.params);
      return null;
    }
    return createOrGetWorkflow(
      env.CHARACTER_ANALYSIS_WORKFLOW,
      workflowInstanceIdForEvent(row.id, payload.type),
      payload.params,
    );
  }
  if (payload.type === "generation.start") {
    if (!env.GENERATION_WORKFLOW) {
      const { createDataStoreStrategy } = await import("../storage/strategy");
      await createDataStoreStrategy(env).processGeneration(payload.params);
      return null;
    }
    return createOrGetWorkflow(
      env.GENERATION_WORKFLOW,
      workflowInstanceIdForEvent(row.id, payload.type),
      payload.params,
    );
  }
  if (payload.type === "profile.rebuild") {
    if (!env.PROFILE_REBUILD_WORKFLOW) {
      const { processProfileRebuild } = await import("./profile");
      await processProfileRebuild(env, payload.params);
      return null;
    }
    return createOrGetWorkflow(
      env.PROFILE_REBUILD_WORKFLOW,
      workflowInstanceIdForEvent(row.id, payload.type),
      payload.params,
    );
  }
  if (!env.ACCOUNT_EXPORT_WORKFLOW) {
    const { processAccountExport } = await import("./exports");
    await processAccountExport(env, payload.params);
    return null;
  }
  return createOrGetWorkflow(
    env.ACCOUNT_EXPORT_WORKFLOW,
    workflowInstanceIdForEvent(row.id, payload.type),
    payload.params,
  );
}

export async function dispatchOutboxEvent(env: Env, eventId: string): Promise<boolean> {
  const leaseOwner = crypto.randomUUID();
  const now = nowIso();
  const leaseExpires = new Date(Date.now() + 60_000).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE outbox_events SET status='publishing',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1
     WHERE id=? AND status IN ('pending','deferred_capacity','publishing') AND available_at<=?
       AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempt_count<10`,
  )
    .bind(leaseOwner, leaseExpires, eventId, now, now)
    .run();
  if (!claim.meta.changes) return false;
  const row = await first<OutboxRow>(
    env.DB.prepare(
      `SELECT id,aggregate_id,payload_json,attempt_count FROM outbox_events WHERE id=? AND lease_owner=?`,
    ).bind(eventId, leaseOwner),
  );
  if (!row) return false;
  try {
    const workflowId = await deliver(env, row);
    const completed = nowIso();
    await env.DB.batch([
      ...(workflowId
        ? [
            env.DB.prepare(
              `UPDATE jobs SET workflow_instance_id=COALESCE(workflow_instance_id,?),updated_at=?
               WHERE id=? AND status IN ('queued','retrying')`,
            ).bind(workflowId, completed, row.aggregate_id),
          ]
        : []),
      env.DB.prepare(
        `UPDATE outbox_events SET status='published',published_at=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=?`,
      ).bind(completed, eventId, leaseOwner),
    ]);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 100) : "DISPATCH_FAILED";
    const dead = row.attempt_count >= 10;
    const next = new Date(Date.now() + 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE outbox_events SET status=?,available_at=?,last_error_code=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=?`,
      ).bind(dead ? "dead" : "pending", next, code, eventId, leaseOwner),
      ...(dead
        ? [
            env.DB.prepare(
              `UPDATE jobs SET status='failed',error_code='DISPATCH_EXHAUSTED',retryable=1,
               updated_at=?,completed_at=?,revision=revision+1
               WHERE id=? AND status IN ('queued','retrying')`,
            ).bind(nowIso(), nowIso(), row.aggregate_id),
          ]
        : []),
    ]);
    return false;
  }
}

export async function dispatchPendingOutbox(env: Env, limit = 50): Promise<number> {
  const rows = await all<{ id: string }>(
    env.DB.prepare(
      `SELECT id FROM outbox_events
       WHERE status IN ('pending','deferred_capacity','publishing') AND available_at<=?
         AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempt_count<10
       ORDER BY available_at,id LIMIT ?`,
    ).bind(nowIso(), nowIso(), limit),
  );
  let delivered = 0;
  for (const row of rows) if (await dispatchOutboxEvent(env, row.id)) delivered += 1;
  return delivered;
}
