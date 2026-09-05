import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { DarkUnderstandingCandidate } from "../../../shared/contracts/dark-understanding";
import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import type { RefinementContext } from "../../../shared/contracts/refinement";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import type { LlmProvider, LlmRunMetadata } from "../../llm/types";
import type { CharacterAnalysisWorkflowParams } from "../../types";

export type EntryContext = {
  llm: LlmProvider;
  entryId: string;
  ownerUserId: string;
  analysisDomain: AnalysisDomain;
  registrationType: AnyEntryDraft["registrationType"];
  entryRevisionId: string;
  representationId: string;
  baseRepresentationId: string | null;
  characterIdentityId: string;
  sourceSetId: string | null;
  sourceId: string | null;
  payload: AnyEntryDraft;
  reviewExclusions?: unknown;
  preferenceReviewHistory?: unknown;
  refinement?: {
    id: string;
    mode: "questions" | "hypotheses";
    answers: Array<{ question: string; answer: string }>;
    context?: RefinementContext;
  };
  retainedPreferences?: unknown;
};

export type AttributeRow = {
  id: string;
  stable_key: string;
  label: string;
  category: string;
};

export type CharacterAnalysisRetry = {
  jobId: string;
  entryId: string;
  stage: CharacterAnalysisWorkflowParams["stage"];
  inputGeneration: number;
  outboxEventId: string;
};

export type CompletedLlmGroup = {
  operation: string;
  inputHash: string;
  attempts: Array<{ output: unknown; metadata: LlmRunMetadata }>;
};

export type UnderstandingCall = {
  value: UnderstandingCandidate | DarkUnderstandingCandidate;
  metadata: LlmRunMetadata;
  attempts?: Array<{ output: unknown; metadata: LlmRunMetadata }>;
  inputHash: string;
  representationId: string;
};
