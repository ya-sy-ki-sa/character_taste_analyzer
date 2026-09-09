import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import { entryPreferenceContext } from "../../../shared/entry-input";
import { PREFERENCE_REFINEMENT_INSTRUCTION } from "../../llm/prompts/refinement";
import type { EntryContext } from "./types";

export function refinementInstruction(entry: EntryContext): string {
  if (!entry.refinement) return "";
  if (entry.refinement.mode === "hypotheses") throw new Error("HYPOTHESIS_PREVIEW_REQUIRED");
  return `${PREFERENCE_REFINEMENT_INSTRUCTION}\n既存の好み: ${JSON.stringify(entry.retainedPreferences ?? [])}\n許可Pointer: ${JSON.stringify(entry.refinement.answers.map((_, index) => `/preference/clarifications/${entry.refinement?.id}/${index}`))}`;
}

export function preferenceContextFor(payload: AnyEntryDraft) {
  return {
    schemaVersion: "2" as const,
    entryScope: entryPreferenceContext(payload) ?? null,
    subjects: [],
    relationships: [],
    narrativePhases: [],
    conditions: [],
    exceptions: [],
  };
}

export function inputEvidence(
  pointer: string,
  quote: string | null,
  inferenceType: "direct" | "paraphrase" | "inferred",
) {
  return [
    {
      sourceRef: `input:${pointer.slice(1)}`,
      sourceUrl: null,
      inputPointer: pointer,
      quote,
      inferenceType,
    },
  ];
}

export function modelKnowledgeEvidence() {
  return [
    {
      sourceRef: "model_knowledge",
      sourceUrl: null,
      inputPointer: null,
      quote: null,
      inferenceType: "inferred" as const,
    },
  ];
}
