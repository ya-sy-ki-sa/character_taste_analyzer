import { snapshotItemLabel } from "../../shared/presentation-labels";
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
  listIdentityCandidates,
  listEntries,
  loadEntryReview,
  mutateUnderstandingReview,
  rejectPreferenceAnalysisItem,
} from "../services/entries";
import {
  createGenerationRequest,
  deleteGeneration,
  listGenerations,
  processGeneration,
  retryGeneration,
} from "../services/generation";
import { loadCurrentGraph } from "../services/graph";
import { outboxStatement } from "../services/orchestration";
import { loadCurrentProfile, loadProjectionFreshness } from "../services/profile";
import type { Env } from "../types";
import type { CharacterTasteDataStoreStrategy } from "./strategy";

export function createD1DataStoreStrategy(env: Env): CharacterTasteDataStoreStrategy {
  return {
    id: "d1",
    createEntry: (ownerUserId, draft, idempotencyKey) => createEntry(env, ownerUserId, draft, idempotencyKey),
    listIdentityCandidates: (ownerUserId, input) => listIdentityCandidates(env, ownerUserId, input),
    createEntryReanalysis: (ownerUserId, entryId, input, idempotencyKey) =>
      createEntryReanalysis(env, ownerUserId, entryId, input, idempotencyKey),
    listEntries: (ownerUserId) => listEntries(env, ownerUserId),
    loadEntryReview: (ownerUserId, entryId) => loadEntryReview(env, ownerUserId, entryId),
    mutateUnderstandingReview: (ownerUserId, snapshotId, input, idempotencyKey) =>
      mutateUnderstandingReview(env, ownerUserId, snapshotId, input, idempotencyKey),
    confirmUnderstanding: (ownerUserId, snapshotId) => confirmUnderstanding(env, ownerUserId, snapshotId),
    rejectPreferenceAnalysisItem: (ownerUserId, analysisRunId, targetId) =>
      rejectPreferenceAnalysisItem(env, ownerUserId, analysisRunId, targetId),
    archiveEntry: async (ownerUserId, entryId) => {
      const now = nowIso();
      const state = await first<{ desired_generation: number; built_generation: number }>(
        env.DB.prepare(
          `SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`,
        ).bind(ownerUserId),
      );
      const desiredGeneration = (state?.desired_generation ?? 0) + 1;
      const jobId = crypto.randomUUID();
      const outbox = await outboxStatement(
        env,
        ownerUserId,
        "job",
        jobId,
        1,
        {
          type: "profile.rebuild",
          params: { jobId, ownerUserId, desiredGeneration },
        },
        `profile:${ownerUserId}:${desiredGeneration}`,
        entryId,
      );
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE user_character_entries SET status='archived',archived_at=?,updated_at=?,revision=revision+1
           WHERE id=? AND owner_user_id=? AND status='active'`,
        ).bind(now, now, entryId, ownerUserId),
        env.DB.prepare(`
          INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
          VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
            desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
        `).bind(ownerUserId, desiredGeneration, state?.built_generation ?? 0, now),
        env.DB.prepare(
          `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
           progress_total,current_step,retryable,revision,created_at,updated_at)
           VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?)`,
        ).bind(jobId, ownerUserId, ownerUserId, desiredGeneration, now, now),
        outbox.statement,
      ]);
      if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_ARCHIVE_FAILED");
      if (!results[0].meta.changes) throw new Error("ENTRY_NOT_FOUND");
      return { outboxEventId: outbox.id };
    },
    processCharacterAnalysis: (params) => processCharacterAnalysis(env, params),
    processPreferenceAnalysis: (params) => processPreferenceAnalysis(env, params),
    retryCharacterAnalysis: (ownerUserId, jobId, retryId) => retryCharacterAnalysis(env, ownerUserId, jobId, retryId),
    activateAnalysisAndRebuild: (ownerUserId, analysisRunId) =>
      activateAnalysisAndRebuild(env, ownerUserId, analysisRunId),
    loadCurrentProfile: (ownerUserId) => loadCurrentProfile(env, ownerUserId),
    loadProjectionFreshness: (ownerUserId) => loadProjectionFreshness(env, ownerUserId),
    loadProfileSnapshotItems: async (ownerUserId) => {
      const freshness = await loadProjectionFreshness(env, ownerUserId);
      if (freshness.status !== "fresh") return { snapshot: null, items: [] };
      const snapshot = await first<{ id: string; profile_generation: number }>(
        env.DB.prepare(`
          SELECT ps.id,ps.profile_generation
          FROM profile_snapshots ps JOIN profile_projections pp ON pp.id=ps.profile_projection_id
          WHERE ps.owner_user_id=? AND pp.status='current'
          ORDER BY ps.profile_generation DESC,ps.created_at DESC LIMIT 1
        `).bind(ownerUserId),
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
      const attributeRows = await all<{ stable_key: string; label: string }>(
        env.DB.prepare(`
          SELECT ad.stable_key,ad.label FROM attribute_definitions ad
          JOIN attribute_schema_versions av ON av.id=ad.schema_version_id
          WHERE ad.status='active' AND av.status='active'
        `),
      );
      const attributeLabels = new Map(attributeRows.map((row) => [row.stable_key, row.label]));
      return {
        snapshot: { id: snapshot.id, generation: snapshot.profile_generation },
        items: items.map((item) => {
          const view = {
            id: item.id,
            type: item.item_type,
            stableKey: item.stable_key,
            label: item.label,
            payload: JSON.parse(item.payload_json) as Record<string, unknown>,
          };
          return { ...view, label: snapshotItemLabel(view, attributeLabels) };
        }),
      };
    },
    loadCurrentGraph: (ownerUserId, detail) => loadCurrentGraph(env, ownerUserId, detail),
    createGenerationRequest: (ownerUserId, input, idempotencyKey) =>
      createGenerationRequest(env, ownerUserId, input, idempotencyKey),
    listGenerations: (ownerUserId) => listGenerations(env, ownerUserId),
    deleteGeneration: (ownerUserId, generationRequestId) => deleteGeneration(env, ownerUserId, generationRequestId),
    processGeneration: (params) => processGeneration(env, params),
    retryGeneration: (ownerUserId, jobId, retryId) => retryGeneration(env, ownerUserId, jobId, retryId),
    loadJob: (ownerUserId, jobId) =>
      first<Record<string, unknown>>(
        env.DB.prepare(
          `SELECT id,job_type,status,target_type,target_id,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,created_at,updated_at,completed_at FROM jobs WHERE id=? AND owner_user_id=?`,
        ).bind(jobId, ownerUserId),
      ),
  };
}
