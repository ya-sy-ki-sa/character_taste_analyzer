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
  listEntries,
  listIdentityCandidates,
  loadEntryReview,
  mutatePreferenceReview,
  mutateUnderstandingReview,
  rejectPreferenceAnalysisItem,
  reviewDarkScopeAssessment,
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
import { ensureCurrentProfileAlgorithm, loadCurrentProfile, loadProjectionFreshness } from "../services/profile";
import type { Env } from "../types";
import type { CharacterTasteDataStoreStrategy } from "./strategy";

export function createD1DataStoreStrategy(env: Env): CharacterTasteDataStoreStrategy {
  return {
    id: "d1",
    createEntry: (ownerUserId, analysisDomain, draft, idempotencyKey) =>
      createEntry(env, ownerUserId, analysisDomain, draft, idempotencyKey),
    listIdentityCandidates: (ownerUserId, analysisDomain, input) =>
      listIdentityCandidates(env, ownerUserId, analysisDomain, input),
    createEntryReanalysis: (ownerUserId, analysisDomain, entryId, input, idempotencyKey) =>
      createEntryReanalysis(env, ownerUserId, analysisDomain, entryId, input, idempotencyKey),
    listEntries: (ownerUserId, analysisDomain) => listEntries(env, ownerUserId, analysisDomain),
    loadEntryReview: (ownerUserId, analysisDomain, entryId) =>
      loadEntryReview(env, ownerUserId, analysisDomain, entryId),
    mutateUnderstandingReview: (ownerUserId, analysisDomain, snapshotId, input, idempotencyKey) =>
      mutateUnderstandingReview(env, ownerUserId, analysisDomain, snapshotId, input, idempotencyKey),
    confirmUnderstanding: (ownerUserId, analysisDomain, snapshotId) =>
      confirmUnderstanding(env, ownerUserId, analysisDomain, snapshotId),
    rejectPreferenceAnalysisItem: (ownerUserId, analysisDomain, analysisRunId, targetId) =>
      rejectPreferenceAnalysisItem(env, ownerUserId, analysisDomain, analysisRunId, targetId),
    mutatePreferenceReview: (ownerUserId, analysisDomain, analysisRunId, input, idempotencyKey) =>
      mutatePreferenceReview(env, ownerUserId, analysisDomain, analysisRunId, input, idempotencyKey),
    reviewDarkScopeAssessment: (ownerUserId, assessmentId, input) =>
      reviewDarkScopeAssessment(env, ownerUserId, assessmentId, input),
    archiveEntry: async (ownerUserId, analysisDomain, entryId) => {
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
           WHERE id=? AND owner_user_id=? AND analysis_domain=? AND status='active'`,
        ).bind(now, now, entryId, ownerUserId, analysisDomain),
        env.DB.prepare(`
          INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
          VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
            desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
        `).bind(ownerUserId, desiredGeneration, state?.built_generation ?? 0, now),
        env.DB.prepare(
          `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
           progress_total,current_step,retryable,revision,created_at,updated_at,analysis_domain)
           VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?,?)`,
        ).bind(jobId, ownerUserId, ownerUserId, desiredGeneration, now, now, analysisDomain),
        outbox.statement,
      ]);
      if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_ARCHIVE_FAILED");
      if (!results[0].meta.changes) throw new Error("ENTRY_NOT_FOUND");
      return { outboxEventId: outbox.id };
    },
    processCharacterAnalysis: (params) => processCharacterAnalysis(env, params),
    processPreferenceAnalysis: (params) => processPreferenceAnalysis(env, params),
    retryCharacterAnalysis: (ownerUserId, jobId, retryId) => retryCharacterAnalysis(env, ownerUserId, jobId, retryId),
    activateAnalysisAndRebuild: (ownerUserId, analysisDomain, analysisRunId) =>
      activateAnalysisAndRebuild(env, ownerUserId, analysisDomain, analysisRunId),
    loadCurrentProfile: (ownerUserId, analysisDomain) => loadCurrentProfile(env, ownerUserId, analysisDomain),
    ensureCurrentProfileAlgorithm: (ownerUserId, analysisDomain) =>
      ensureCurrentProfileAlgorithm(env, ownerUserId, analysisDomain),
    loadProjectionFreshness: (ownerUserId) => loadProjectionFreshness(env, ownerUserId),
    loadProfileSnapshotItems: async (ownerUserId, analysisDomain) => {
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
          `SELECT id,item_type,stable_key,label,payload_json FROM profile_snapshot_items WHERE profile_snapshot_id=? AND analysis_domain=? ORDER BY ordinal,id`,
        ).bind(snapshot.id, analysisDomain),
      );
      const attributeRows = await all<{ stable_key: string; label: string }>(
        env.DB.prepare(`
          SELECT ad.stable_key,ad.label FROM attribute_definitions ad
          JOIN attribute_schema_versions av ON av.id=ad.schema_version_id
          WHERE ad.status='active' AND av.status='active' AND av.analysis_domain=?
        `).bind(analysisDomain),
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
    loadCurrentGraph: (ownerUserId, analysisDomain, detail) =>
      loadCurrentGraph(env, ownerUserId, analysisDomain, detail),
    createGenerationRequest: (ownerUserId, analysisDomain, input, idempotencyKey) =>
      createGenerationRequest(env, ownerUserId, analysisDomain, input, idempotencyKey),
    listGenerations: (ownerUserId, analysisDomain) => listGenerations(env, ownerUserId, analysisDomain),
    deleteGeneration: (ownerUserId, analysisDomain, generationRequestId) =>
      deleteGeneration(env, ownerUserId, analysisDomain, generationRequestId),
    processGeneration: (params) => processGeneration(env, params),
    retryGeneration: (ownerUserId, jobId, retryId) => retryGeneration(env, ownerUserId, jobId, retryId),
    loadJob: (ownerUserId, analysisDomain, jobId) =>
      first<Record<string, unknown>>(
        env.DB.prepare(
          `SELECT id,job_type,status,target_type,target_id,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,created_at,updated_at,completed_at FROM jobs WHERE id=? AND owner_user_id=? AND analysis_domain=?`,
        ).bind(jobId, ownerUserId, analysisDomain),
      ),
  };
}
