import type { AnalysisDomain } from "./analysis-domain";
import type { GenerationRequestInput } from "./schemas";

export type Treatment = "required" | "include" | "explore" | "prohibit";
export type GenerationSelection = {
  profileSnapshotItemId: string;
  stableKey: string;
  label: string;
  treatment: Treatment;
  weight: number;
  condition: Record<string, unknown>;
  responseChannel: string | null;
  reactionDescription: string | null;
  polarity: { positive: number; negative: number } | null;
  valueStance: {
    target: string;
    targetType: string;
    orientation: string;
    stance: string;
    scope: Record<string, unknown>;
  } | null;
  rationale: string;
  overrideText: null;
};
export type GenerationBrief = {
  schemaVersion: "2.0";
  analysisDomain: AnalysisDomain;
  briefId: string;
  generationRequestId: string;
  profileSnapshot: {
    id: string;
    generation: number;
    contentHash: string;
    ontologyVersion: string;
    algorithmVersion: string;
  };
  mode: GenerationRequestInput["mode"];
  purpose: string;
  creativeContext: {
    world: string | null;
    genre: string | null;
    role: string | null;
    tone: string | null;
    targetDetail: "detailed";
  };
  preferenceSelections: GenerationSelection[];
  valuePolicy: {
    allowedOrientations: string[];
    requiredStances: Array<{ target: string; stance: string; scope: Record<string, unknown> }>;
    redemption: "required" | "allowed" | "not_required" | "prohibited";
    hiddenGoodness: "required" | "allowed" | "not_required" | "prohibited";
    moralJustification: "not_required";
    punishmentOrDefeat: "not_required";
  };
  constraints: {
    required: string[];
    prohibited: string[];
    contentBoundaries: string[];
    freeInstruction: string | null;
  };
  nonRequirements: string[];
  similarityPolicy: {
    avoidNamedCharacters: string[];
    nameThreshold: number;
    semanticThreshold: number;
    combinationThreshold: number;
  };
  provenance: { selectedItemIds: string[]; userConstraintHash: string; compiledAt: string };
};
