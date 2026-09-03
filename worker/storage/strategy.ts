import type { AnalysisDomain } from "../../shared/analysis-domain";
import type {
  AnyEntryReanalysisInput,
  AnyEntrySubmission,
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
  listEntries,
  listIdentityCandidates,
  loadEntryReview,
  mutatePreferenceReview,
  mutateUnderstandingReview,
  rejectPreferenceAnalysisItem,
  reviewDarkScopeAssessment,
} from "../services/entries";
import type {
  createGenerationRequest,
  deleteGeneration,
  listGenerations,
  processGeneration,
  retryGeneration,
} from "../services/generation";
import type { loadCurrentGraph } from "../services/graph";
import type { ensureCurrentProfileAlgorithm, loadCurrentProfile, loadProjectionFreshness } from "../services/profile";
import type { CharacterAnalysisWorkflowParams, Env, GenerationWorkflowParams } from "../types";
import { createD1DataStoreStrategy } from "./d1-strategy";

export type ProfileSnapshotItems = {
  snapshot: { id: string; generation: number } | null;
  items: Array<{ id: string; type: string; stableKey: string; label: string; payload: Record<string, unknown> }>;
};

/** Domain storage port. Adapters may change without changing HTTP or Workflow orchestration. */
export interface CharacterTasteDataStoreStrategy {
  readonly id: string;
  createEntry(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    draft: AnyEntrySubmission,
    idempotencyKey: string,
  ): ReturnType<typeof createEntry>;
  listIdentityCandidates(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    input: IdentityCandidateRequest,
  ): ReturnType<typeof listIdentityCandidates>;
  createEntryReanalysis(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    entryId: string,
    input: AnyEntryReanalysisInput,
    idempotencyKey: string,
  ): ReturnType<typeof createEntryReanalysis>;
  listEntries(ownerUserId: string, analysisDomain: AnalysisDomain): ReturnType<typeof listEntries>;
  loadEntryReview(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    entryId: string,
  ): ReturnType<typeof loadEntryReview>;
  mutateUnderstandingReview(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    snapshotId: string,
    input: UnderstandingReviewMutation,
    idempotencyKey: string,
  ): ReturnType<typeof mutateUnderstandingReview>;
  confirmUnderstanding(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    snapshotId: string,
  ): ReturnType<typeof confirmUnderstanding>;
  rejectPreferenceAnalysisItem(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    analysisRunId: string,
    targetId: string,
  ): ReturnType<typeof rejectPreferenceAnalysisItem>;
  mutatePreferenceReview(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    analysisRunId: string,
    input: import("../../shared/schemas").PreferenceReviewMutation,
    idempotencyKey: string,
  ): ReturnType<typeof mutatePreferenceReview>;
  reviewDarkScopeAssessment(
    ownerUserId: string,
    assessmentId: string,
    input: import("../../shared/schemas").DarkScopeReviewRequest,
  ): ReturnType<typeof reviewDarkScopeAssessment>;
  archiveEntry(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    entryId: string,
  ): Promise<{ outboxEventId: string }>;
  processCharacterAnalysis(params: CharacterAnalysisWorkflowParams): ReturnType<typeof processCharacterAnalysis>;
  processPreferenceAnalysis(params: CharacterAnalysisWorkflowParams): ReturnType<typeof processPreferenceAnalysis>;
  retryCharacterAnalysis(
    ownerUserId: string,
    jobId: string,
    retryId: string,
  ): ReturnType<typeof retryCharacterAnalysis>;
  activateAnalysisAndRebuild(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    analysisRunId: string,
  ): ReturnType<typeof activateAnalysisAndRebuild>;
  loadCurrentProfile(ownerUserId: string, analysisDomain: AnalysisDomain): ReturnType<typeof loadCurrentProfile>;
  ensureCurrentProfileAlgorithm(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
  ): ReturnType<typeof ensureCurrentProfileAlgorithm>;
  loadProjectionFreshness(ownerUserId: string): ReturnType<typeof loadProjectionFreshness>;
  loadProfileSnapshotItems(ownerUserId: string, analysisDomain: AnalysisDomain): Promise<ProfileSnapshotItems>;
  loadCurrentGraph(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    detail: "summary" | "standard" | "expanded",
  ): ReturnType<typeof loadCurrentGraph>;
  createGenerationRequest(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    input: GenerationRequestInput,
    idempotencyKey: string,
  ): ReturnType<typeof createGenerationRequest>;
  listGenerations(ownerUserId: string, analysisDomain: AnalysisDomain): ReturnType<typeof listGenerations>;
  deleteGeneration(
    ownerUserId: string,
    analysisDomain: AnalysisDomain,
    generationRequestId: string,
  ): ReturnType<typeof deleteGeneration>;
  processGeneration(params: GenerationWorkflowParams): ReturnType<typeof processGeneration>;
  retryGeneration(ownerUserId: string, jobId: string, retryId: string): ReturnType<typeof retryGeneration>;
  loadJob(ownerUserId: string, analysisDomain: AnalysisDomain, jobId: string): Promise<Record<string, unknown> | null>;
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
