import type {
  EntryReanalysisInput,
  EntrySubmission,
  GenerationRequestInput,
  IdentityCandidateRequest,
  UnderstandingReviewMutation,
} from "../../shared/schemas";
import type {
  activateAnalysisAndRebuild,
  processCharacterAnalysis,
  processPreferenceAnalysis,
  retryCharacterAnalysis,
} from "../services/analysis";
import type {
  confirmUnderstanding,
  createEntry,
  createEntryReanalysis,
  listIdentityCandidates,
  listEntries,
  loadEntryReview,
  mutateUnderstandingReview,
  rejectPreferenceAnalysisItem,
} from "../services/entries";
import type {
  createGenerationRequest,
  deleteGeneration,
  listGenerations,
  processGeneration,
  retryGeneration,
} from "../services/generation";
import type { loadCurrentGraph } from "../services/graph";
import type { loadCurrentProfile, loadProjectionFreshness } from "../services/profile";
import type { CharacterAnalysisWorkflowParams, Env, GenerationWorkflowParams } from "../types";
import { createD1DataStoreStrategy } from "./d1-strategy";

export type ProfileSnapshotItems = {
  snapshot: { id: string; generation: number } | null;
  items: Array<{ id: string; type: string; stableKey: string; label: string; payload: Record<string, unknown> }>;
};

/** Domain storage port. Adapters may change without changing HTTP or Workflow orchestration. */
export interface CharacterTasteDataStoreStrategy {
  readonly id: string;
  createEntry(ownerUserId: string, draft: EntrySubmission, idempotencyKey: string): ReturnType<typeof createEntry>;
  listIdentityCandidates(
    ownerUserId: string,
    input: IdentityCandidateRequest,
  ): ReturnType<typeof listIdentityCandidates>;
  createEntryReanalysis(
    ownerUserId: string,
    entryId: string,
    input: EntryReanalysisInput,
    idempotencyKey: string,
  ): ReturnType<typeof createEntryReanalysis>;
  listEntries(ownerUserId: string): ReturnType<typeof listEntries>;
  loadEntryReview(ownerUserId: string, entryId: string): ReturnType<typeof loadEntryReview>;
  mutateUnderstandingReview(
    ownerUserId: string,
    snapshotId: string,
    input: UnderstandingReviewMutation,
    idempotencyKey: string,
  ): ReturnType<typeof mutateUnderstandingReview>;
  confirmUnderstanding(ownerUserId: string, snapshotId: string): ReturnType<typeof confirmUnderstanding>;
  rejectPreferenceAnalysisItem(
    ownerUserId: string,
    analysisRunId: string,
    targetId: string,
  ): ReturnType<typeof rejectPreferenceAnalysisItem>;
  archiveEntry(ownerUserId: string, entryId: string): Promise<{ outboxEventId: string }>;
  processCharacterAnalysis(params: CharacterAnalysisWorkflowParams): ReturnType<typeof processCharacterAnalysis>;
  processPreferenceAnalysis(params: CharacterAnalysisWorkflowParams): ReturnType<typeof processPreferenceAnalysis>;
  retryCharacterAnalysis(
    ownerUserId: string,
    jobId: string,
    retryId: string,
  ): ReturnType<typeof retryCharacterAnalysis>;
  activateAnalysisAndRebuild(ownerUserId: string, analysisRunId: string): ReturnType<typeof activateAnalysisAndRebuild>;
  loadCurrentProfile(ownerUserId: string): ReturnType<typeof loadCurrentProfile>;
  loadProjectionFreshness(ownerUserId: string): ReturnType<typeof loadProjectionFreshness>;
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
  deleteGeneration(ownerUserId: string, generationRequestId: string): ReturnType<typeof deleteGeneration>;
  processGeneration(params: GenerationWorkflowParams): ReturnType<typeof processGeneration>;
  retryGeneration(ownerUserId: string, jobId: string, retryId: string): ReturnType<typeof retryGeneration>;
  loadJob(ownerUserId: string, jobId: string): Promise<Record<string, unknown> | null>;
}

type DataStoreStrategyFactory = (env: Env) => CharacterTasteDataStoreStrategy;

const strategyFactories: Readonly<Record<string, DataStoreStrategyFactory>> = {
  d1: createD1DataStoreStrategy,
};

export function createDataStoreStrategy(env: Env): CharacterTasteDataStoreStrategy {
  const selected = env.DATASTORE_STRATEGY || "d1";
  const factory = strategyFactories[selected];
  if (!factory) throw new Error(`DATASTORE_STRATEGY_UNSUPPORTED:${selected}`);
  return factory(env);
}
