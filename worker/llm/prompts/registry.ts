import { DARK_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION } from "./analysis";
import { DARK_GENERATION_SYSTEM, GENERATION_SYSTEM, GENERATION_VALIDATION_SYSTEM } from "./generation";
import { HYPOTHESIS_SYSTEM } from "./hypotheses";
import { EXPLICIT_PREFERENCE_INSTRUCTION, PREFERENCE_PROMPT_VERSION } from "./preference";
import { SEMANTIC_AUDIT_INSTRUCTION, SEMANTIC_AUDIT_POLICY } from "./semantic-audit";
import {
  UNDERSTANDING_COMPLETENESS_INSTRUCTION,
  UNDERSTANDING_INFORMATION_INSTRUCTION,
  UNDERSTANDING_INFORMATION_POLICY,
} from "./understanding";

export const promptRegistry = {
  semanticIntegrity: { promptVersion: SEMANTIC_AUDIT_POLICY, text: SEMANTIC_AUDIT_INSTRUCTION },
  understandingInformation: {
    promptVersion: UNDERSTANDING_INFORMATION_POLICY,
    text: `${UNDERSTANDING_COMPLETENESS_INSTRUCTION}\n${UNDERSTANDING_INFORMATION_INSTRUCTION}`,
  },
  preference: { promptVersion: `preference/${PREFERENCE_PROMPT_VERSION}`, text: EXPLICIT_PREFERENCE_INSTRUCTION },
  citationVerification: { promptVersion: CITATION_POLICY_VERSION, text: CITATION_INSTRUCTION },
  preferenceHypotheses: { promptVersion: "preference_hypotheses/v2.1.0", text: HYPOTHESIS_SYSTEM },
  darkAnalysis: { promptVersion: "dark_analysis/v2.0.0", text: DARK_SYSTEM_INSTRUCTION },
  darkGeneration: { promptVersion: "dark_generation/v2.2.0", text: DARK_GENERATION_SYSTEM },
  analysis: { promptVersion: "character_understanding/v2.0.0", text: SYSTEM_INSTRUCTION },
  generation: { promptVersion: "character_generation/v2.2.0", text: GENERATION_SYSTEM },
  generationValidation: { promptVersion: "generation_validation/v2.2.0", text: GENERATION_VALIDATION_SYSTEM },
} as const;

import { CITATION_INSTRUCTION, CITATION_POLICY_VERSION } from "../../platform/provenance/registry";
