import { CITATION_INSTRUCTION, CITATION_POLICY_VERSION } from "../../platform/provenance/registry";
import { ANALYSIS_PROMPT_VERSION, DARK_SYSTEM_INSTRUCTION } from "./analysis";
import { DARK_BASELINE_SYSTEM, DARK_SCOPE_SYSTEM, DARK_UNDERSTANDING_SYSTEM } from "./dark";
import {
  DARK_GENERATION_SYSTEM,
  GENERATION_DIRECTIONS,
  GENERATION_PROMPT_VERSION,
  GENERATION_REPAIR_INSTRUCTION,
  GENERATION_SYSTEM,
  GENERATION_VARIANT_INSTRUCTION,
} from "./generation";
import { HYPOTHESIS_PROMPT_VERSION, hypothesisSystem } from "./hypotheses";
import { ANALYSIS_JUDGMENT_POLICY_VERSION, analysisJudgmentCanonicalQuestions } from "./judgment-analysis";
import { GENERATION_JUDGMENT_PROMPT, GENERATION_JUDGMENT_VERSION } from "./judgment-generation";
import { PREFERENCE_PROMPT_VERSION, preferenceSystem } from "./preference";
import { PREFERENCE_REFINEMENT_INSTRUCTION } from "./refinement";
import { FORMAT_REPAIR_INSTRUCTION } from "./repair";
import {
  UNDERSTANDING_COMPLETION_INSTRUCTION,
  UNDERSTANDING_INFORMATION_POLICY,
  understandingSystem,
} from "./understanding";

export const promptRegistry = {
  analysisJudgment: {
    promptVersion: ANALYSIS_JUDGMENT_POLICY_VERSION,
    text: JSON.stringify(analysisJudgmentCanonicalQuestions()),
  },
  understandingCompletion: {
    promptVersion: UNDERSTANDING_INFORMATION_POLICY,
    text: UNDERSTANDING_COMPLETION_INSTRUCTION,
  },
  generationJudgment: { promptVersion: GENERATION_JUDGMENT_VERSION, text: GENERATION_JUDGMENT_PROMPT },
  preference: {
    promptVersion: `preference/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("standard"),
  },
  darkPreference: {
    promptVersion: `dark_preference/${PREFERENCE_PROMPT_VERSION}`,
    text: preferenceSystem("dark"),
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
  analysis: {
    promptVersion: `character_understanding/${ANALYSIS_PROMPT_VERSION}`,
    text: understandingSystem(),
  },
  generation: { promptVersion: `character_generation/${GENERATION_PROMPT_VERSION}`, text: GENERATION_SYSTEM },
  darkGeneration: { promptVersion: `dark_generation/${GENERATION_PROMPT_VERSION}`, text: DARK_GENERATION_SYSTEM },

  generationVariants: {
    promptVersion: `generation_variants/${GENERATION_PROMPT_VERSION}`,
    text: [GENERATION_VARIANT_INSTRUCTION, ...GENERATION_DIRECTIONS].join("\n"),
  },
  generationRepair: {
    promptVersion: `generation_repair/${GENERATION_PROMPT_VERSION}`,
    text: GENERATION_REPAIR_INSTRUCTION,
  },

  formatRepair: { promptVersion: "format_repair/v1.1.0", text: FORMAT_REPAIR_INSTRUCTION },
} as const;
