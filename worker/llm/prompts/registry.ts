import { DARK_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION } from "./analysis";
import { DARK_GENERATION_SYSTEM, GENERATION_SYSTEM, GENERATION_VALIDATION_SYSTEM } from "./generation";
import { HYPOTHESIS_SYSTEM } from "./hypotheses";

export const promptRegistry = {
  preferenceHypotheses: { promptVersion: "preference_hypotheses/v2.1.0", text: HYPOTHESIS_SYSTEM },
  darkAnalysis: { promptVersion: "dark_analysis/v2.0.0", text: DARK_SYSTEM_INSTRUCTION },
  darkGeneration: { promptVersion: "dark_generation/v2.0.0", text: DARK_GENERATION_SYSTEM },
  analysis: { promptVersion: "character_understanding/v2.0.0", text: SYSTEM_INSTRUCTION },
  generation: { promptVersion: "character_generation/v2.0.0", text: GENERATION_SYSTEM },
  generationValidation: { promptVersion: "generation_validation/v2.0.0", text: GENERATION_VALIDATION_SYSTEM },
} as const;
