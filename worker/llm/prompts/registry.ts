import { CITATION_INSTRUCTION, CITATION_POLICY_VERSION } from "../../platform/provenance/registry";
import { ANALYSIS_PROMPT_VERSION, DARK_SYSTEM_INSTRUCTION } from "./analysis";
import {
  DARK_BASELINE_SYSTEM,
  DARK_SCOPE_SYSTEM,
  DARK_UNDERSTANDING_AUDIT_SYSTEM,
  DARK_UNDERSTANDING_SYSTEM,
} from "./dark";
import {
  DARK_GENERATION_SYSTEM,
  GENERATION_COMPARISON_SYSTEM,
  GENERATION_DIRECTIONS,
  GENERATION_PROMPT_VERSION,
  GENERATION_REPAIR_INSTRUCTION,
  GENERATION_SYSTEM,
  GENERATION_VARIANT_INSTRUCTION,
  generationValidationSystem,
} from "./generation";
import { HYPOTHESIS_PROMPT_VERSION, hypothesisSystem } from "./hypotheses";
import { PREFERENCE_PROMPT_VERSION, preferenceSystem } from "./preference";
import { PREFERENCE_REFINEMENT_INSTRUCTION } from "./refinement";
import { FORMAT_REPAIR_INSTRUCTION } from "./repair";
import {
  PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION,
  SEMANTIC_AUDIT_POLICY,
  UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION,
} from "./semantic-audit";
import {
  UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION,
  UNDERSTANDING_COMPLETION_INSTRUCTION,
  UNDERSTANDING_INFORMATION_POLICY,
  understandingSystem,
} from "./understanding";

export const promptRegistry = {
  semanticIntegrity: { promptVersion: SEMANTIC_AUDIT_POLICY, text: PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION },
  understandingSemanticIntegrity: {
    promptVersion: SEMANTIC_AUDIT_POLICY,
    text: UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION,
  },
  understandingInformation: { promptVersion: UNDERSTANDING_INFORMATION_POLICY, text: understandingSystem("audit") },
  understandingCompletion: {
    promptVersion: UNDERSTANDING_INFORMATION_POLICY,
    text: UNDERSTANDING_COMPLETION_INSTRUCTION,
  },
  understandingAssessmentRepair: {
    promptVersion: UNDERSTANDING_INFORMATION_POLICY,
    text: UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION,
  },
  preference: {
    promptVersion: `preference/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("standard", "extract"),
  },
  preferenceAudit: {
    promptVersion: `preference_audit/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("standard", "audit"),
  },
  darkPreference: {
    promptVersion: `dark_preference/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("dark", "extract"),
  },
  darkPreferenceAudit: {
    promptVersion: `dark_preference_audit/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("dark", "audit"),
  },
  preferenceRefinement: {
    promptVersion: `preference_refinement/${PREFERENCE_PROMPT_VERSION}`,
    text: PREFERENCE_REFINEMENT_INSTRUCTION,
  },
  citationVerification: { promptVersion: CITATION_POLICY_VERSION, text: CITATION_INSTRUCTION },
  preferenceHypotheses: {
    promptVersion: `preference_hypotheses/${HYPOTHESIS_PROMPT_VERSION}`,
    text: hypothesisSystem("standard"),
  },
  darkPreferenceHypotheses: {
    promptVersion: `preference_hypotheses/${HYPOTHESIS_PROMPT_VERSION}`,
    text: hypothesisSystem("dark"),
  },
  darkAnalysis: { promptVersion: `dark_analysis/${ANALYSIS_PROMPT_VERSION}`, text: DARK_SYSTEM_INSTRUCTION },
  darkScope: { promptVersion: `dark_scope_assessment/${ANALYSIS_PROMPT_VERSION}`, text: DARK_SCOPE_SYSTEM },
  darkBaseline: { promptVersion: `dark_baseline_understanding/${ANALYSIS_PROMPT_VERSION}`, text: DARK_BASELINE_SYSTEM },
  darkUnderstanding: {
    promptVersion: `dark_character_understanding/${ANALYSIS_PROMPT_VERSION}`,
    text: DARK_UNDERSTANDING_SYSTEM,
  },
  darkUnderstandingAudit: {
    promptVersion: `dark_understanding_audit/${ANALYSIS_PROMPT_VERSION}`,
    text: DARK_UNDERSTANDING_AUDIT_SYSTEM,
  },
  analysis: {
    promptVersion: `character_understanding/${ANALYSIS_PROMPT_VERSION}`,
    text: understandingSystem("extract"),
  },
  generation: { promptVersion: `character_generation/${GENERATION_PROMPT_VERSION}`, text: GENERATION_SYSTEM },
  darkGeneration: { promptVersion: `dark_generation/${GENERATION_PROMPT_VERSION}`, text: DARK_GENERATION_SYSTEM },
  generationValidation: {
    promptVersion: `generation_validation/${GENERATION_PROMPT_VERSION}`,
    text: generationValidationSystem("standard"),
  },
  darkGenerationValidation: {
    promptVersion: `generation_validation/${GENERATION_PROMPT_VERSION}`,
    text: generationValidationSystem("dark"),
  },
  generationVariants: {
    promptVersion: `generation_variants/${GENERATION_PROMPT_VERSION}`,
    text: [GENERATION_VARIANT_INSTRUCTION, ...GENERATION_DIRECTIONS].join("\n"),
  },
  generationRepair: {
    promptVersion: `generation_repair/${GENERATION_PROMPT_VERSION}`,
    text: GENERATION_REPAIR_INSTRUCTION,
  },
  generationComparison: {
    promptVersion: `generation_comparison/${GENERATION_PROMPT_VERSION}`,
    text: GENERATION_COMPARISON_SYSTEM,
  },
  formatRepair: { promptVersion: "format_repair/v1.1.0", text: FORMAT_REPAIR_INSTRUCTION },
} as const;
