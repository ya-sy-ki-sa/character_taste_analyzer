import type { EntryDraft, EntryReanalysisInput, GenerationRequestInput } from "../../shared/schemas";
import { nowIso } from "../lib/crypto";
import { all, first } from "../lib/db";
import {
  activateAnalysisAndRebuild,
  processCharacterAnalysis,
  processPreferenceAnalysis,
  retryCharacterAnalysis,
} from "../services/analysis";
import {
  confirmUnderstanding,
  createEntry,
  createEntryReanalysis,
  listEntries,
  loadEntryReview,
} from "../services/entries";
import { createGenerationRequest, listGenerations, processGeneration } from "../services/generation";
import { loadCurrentGraph } from "../services/graph";
import { loadCurrentProfile, rebuildProfile } from "../services/profile";
import type { CharacterAnalysisWorkflowParams, Env, GenerationWorkflowParams } from "../types";

export type ProfileSnapshotItems = {
  snapshot: { id: string; generation: number } | null;
  items: Array<{ id: string; type: string; stableKey: string; label: string; payload: Record<string, unknown> }>;
};

/**
 * Character-taste domain data boundary. Authentication intentionally keeps the
 * existing D1-backed mechanism. A future analytical store can replace this
 * strategy without changing HTTP or Workflow orchestration.
 */
export interface CharacterTasteDataStoreStrategy {
  readonly id: string;
  createEntry(ownerUserId: string, draft: EntryDraft, idempotencyKey: string): ReturnType<typeof createEntry>;
  createEntryReanalysis(
    ownerUserId: string,
    entryId: string,
    input: EntryReanalysisInput,
    idempotencyKey: string,
  ): ReturnType<typeof createEntryReanalysis>;
  listEntries(ownerUserId: string): ReturnType<typeof listEntries>;
  loadEntryReview(ownerUserId: string, entryId: string): ReturnType<typeof loadEntryReview>;
  confirmUnderstanding(ownerUserId: string, entryId: string, snapshotId: string): Promise<void>;
  archiveEntry(ownerUserId: string, entryId: string): Promise<void>;
  processCharacterAnalysis(params: CharacterAnalysisWorkflowParams): Promise<void>;
  processPreferenceAnalysis(params: CharacterAnalysisWorkflowParams): Promise<void>;
  retryCharacterAnalysis(ownerUserId: string, jobId: string): ReturnType<typeof retryCharacterAnalysis>;
  activateAnalysisAndRebuild(
    ownerUserId: string,
    entryId: string,
    analysisRunId: string,
  ): ReturnType<typeof activateAnalysisAndRebuild>;
  loadCurrentProfile(ownerUserId: string): ReturnType<typeof loadCurrentProfile>;
  loadProfileSnapshotItems(ownerUserId: string): Promise<ProfileSnapshotItems>;
  loadCurrentGraph(
    ownerUserId: string,
    detail: "summary" | "standard" | "expanded",
  ): ReturnType<typeof loadCurrentGraph>;
  createGenerationRequest(
    ownerUserId: string,
    input: GenerationRequestInput,
    idempotencyKey: string,
  ): ReturnType<typeof createGenerationRequest>;
  listGenerations(ownerUserId: string): ReturnType<typeof listGenerations>;
  processGeneration(params: GenerationWorkflowParams): Promise<void>;
  loadJob(ownerUserId: string, jobId: string): Promise<Record<string, unknown> | null>;
}

function d1Strategy(env: Env): CharacterTasteDataStoreStrategy {
  return {
    id: "d1",
    createEntry: (ownerUserId, draft, idempotencyKey) => createEntry(env, ownerUserId, draft, idempotencyKey),
    createEntryReanalysis: (ownerUserId, entryId, input, idempotencyKey) =>
      createEntryReanalysis(env, ownerUserId, entryId, input, idempotencyKey),
    listEntries: (ownerUserId) => listEntries(env, ownerUserId),
    loadEntryReview: (ownerUserId, entryId) => loadEntryReview(env, ownerUserId, entryId),
    confirmUnderstanding: (ownerUserId, entryId, snapshotId) =>
      confirmUnderstanding(env, ownerUserId, entryId, snapshotId),
    archiveEntry: async (ownerUserId, entryId) => {
      const now = nowIso();
      const result = await env.DB.prepare(
        `UPDATE user_character_entries SET status='archived',archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND deleted_at IS NULL`,
      )
        .bind(now, now, entryId, ownerUserId)
        .run();
      if (!result.meta.changes) throw new Error("ENTRY_NOT_FOUND");
      await rebuildProfile(env, ownerUserId, "entry_archived");
    },
    processCharacterAnalysis: (params) => processCharacterAnalysis(env, params),
    processPreferenceAnalysis: (params) => processPreferenceAnalysis(env, params),
    retryCharacterAnalysis: (ownerUserId, jobId) => retryCharacterAnalysis(env, ownerUserId, jobId),
    activateAnalysisAndRebuild: (ownerUserId, entryId, analysisRunId) =>
      activateAnalysisAndRebuild(env, ownerUserId, entryId, analysisRunId),
    loadCurrentProfile: (ownerUserId) => loadCurrentProfile(env, ownerUserId),
    loadProfileSnapshotItems: async (ownerUserId) => {
      const snapshot = await first<{ id: string; profile_generation: number }>(
        env.DB.prepare(
          `SELECT id,profile_generation FROM profile_snapshots WHERE owner_user_id=? ORDER BY profile_generation DESC,created_at DESC LIMIT 1`,
        ).bind(ownerUserId),
      );
      if (!snapshot) return { snapshot: null, items: [] };
      const items = await all<{
        id: string;
        item_type: string;
        stable_key: string;
        label: string;
        payload_json: string;
      }>(
        env.DB.prepare(
          `SELECT id,item_type,stable_key,label,payload_json FROM profile_snapshot_items WHERE profile_snapshot_id=? ORDER BY ordinal,id`,
        ).bind(snapshot.id),
      );
      return {
        snapshot: { id: snapshot.id, generation: snapshot.profile_generation },
        items: items.map((item) => ({
          id: item.id,
          type: item.item_type,
          stableKey: item.stable_key,
          label: item.label,
          payload: JSON.parse(item.payload_json) as Record<string, unknown>,
        })),
      };
    },
    loadCurrentGraph: (ownerUserId, detail) => loadCurrentGraph(env, ownerUserId, detail),
    createGenerationRequest: (ownerUserId, input, idempotencyKey) =>
      createGenerationRequest(env, ownerUserId, input, idempotencyKey),
    listGenerations: (ownerUserId) => listGenerations(env, ownerUserId),
    processGeneration: (params) => processGeneration(env, params),
    loadJob: (ownerUserId, jobId) =>
      first<Record<string, unknown>>(
        env.DB.prepare(
          `SELECT id,job_type,status,target_type,target_id,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,created_at,updated_at,completed_at FROM jobs WHERE id=? AND owner_user_id=?`,
        ).bind(jobId, ownerUserId),
      ),
  };
}

export function createDataStoreStrategy(env: Env): CharacterTasteDataStoreStrategy {
  const selected = env.DATASTORE_STRATEGY || "d1";
  if (selected === "d1") return d1Strategy(env);
  throw new Error(`DATASTORE_STRATEGY_UNSUPPORTED:${selected}`);
}
