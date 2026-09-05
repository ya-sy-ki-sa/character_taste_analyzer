import type { AnyGeneratedCharacterCandidate, GenerationValidationReport } from "../../../shared/contracts/generation";
import type { SimilarityReport } from "./similarity";

export type Snapshot = {
  id: string;
  owner_user_id: string;
  profile_generation: number;
  content_hash: string;
  ontology_version: string;
  algorithm_version: string;
};

export type SnapshotItem = {
  id: string;
  item_type: string;
  stable_key: string;
  label: string;
  payload_json: string;
};

export type CandidateResult = {
  id: string;
  ordinal: number;
  candidate: AnyGeneratedCharacterCandidate;
  report: GenerationValidationReport;
  similarity: SimilarityReport;
  modelRunId: string;
  comparison: { coherence: string; preferenceFit: string; difference: string; tradeoffs: string[] };
};
