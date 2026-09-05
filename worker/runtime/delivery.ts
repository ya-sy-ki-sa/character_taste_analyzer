import { processAccountExport } from "../features/account/exports";
import { processPreferenceAnalysis } from "../features/analysis/preference";
import { processCharacterAnalysis } from "../features/analysis/understanding";
import { processGeneration } from "../features/generation/process";
import { processProfileRebuild } from "../features/profile/projection";
import type { OutboxRow } from "../platform/outbox/dispatch";
import { workflowInstanceIdForEvent } from "../platform/outbox/protocol";
import type { OutboxPayload } from "../platform/outbox/write";
import type { Env } from "../types";

export type WorkflowBinding<Params> = {
  create(options: { id: string; params: Params }): Promise<{ id: string }>;
  get(id: string): Promise<{ id: string }>;
};

export async function createOrGetWorkflow<Params>(
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

export async function deliver(env: Env, row: OutboxRow): Promise<string | null> {
  const payload = JSON.parse(row.payload_json) as OutboxPayload;
  if (payload.type === "analysis.start") {
    if (!env.CHARACTER_ANALYSIS_WORKFLOW) {
      if (payload.params.stage === "understanding") await processCharacterAnalysis(env, payload.params);
      else await processPreferenceAnalysis(env, payload.params);
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
      await processGeneration(env, payload.params);
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
    await processAccountExport(env, payload.params);
    return null;
  }
  return createOrGetWorkflow(
    env.ACCOUNT_EXPORT_WORKFLOW,
    workflowInstanceIdForEvent(row.id, payload.type),
    payload.params,
  );
}
