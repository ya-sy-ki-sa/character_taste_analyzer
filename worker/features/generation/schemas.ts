import { z } from "zod";
import {
  darkGeneratedCharacterCandidateSchema,
  generatedCharacterCandidateSchema,
  generationValidationReportSchema,
} from "../../../shared/contracts/generation";
import { GENERATION_POLICY_CHECKS } from "./validation";

function selectedIdEnum(ids: readonly string[]) {
  const [first, ...rest] = ids;
  if (!first) throw new Error("GENERATION_SELECTION_EMPTY");
  return z.enum([first, ...rest]);
}

export function candidateSchemasForBrief(briefId: string, selectedItemIds: readonly string[]) {
  const coverage = generatedCharacterCandidateSchema.shape.briefCoverage.element.extend({
    profileSnapshotItemId: selectedIdEnum(selectedItemIds),
  });
  const shape = {
    briefId: z.literal(briefId),
    briefCoverage: z.array(coverage).min(1).max(200),
  };
  return {
    standard: generatedCharacterCandidateSchema.extend(shape),
    dark: darkGeneratedCharacterCandidateSchema.extend(shape),
  };
}

export function validationSchemaForBrief(selectedItemIds: readonly string[]) {
  if (!selectedItemIds.length) throw new Error("GENERATION_SELECTION_EMPTY");
  const check = generationValidationReportSchema.shape.checks.element.extend({
    constraintId: selectedIdEnum([...selectedItemIds, ...GENERATION_POLICY_CHECKS]),
  });
  return generationValidationReportSchema.extend({ checks: z.array(check).max(250) });
}
