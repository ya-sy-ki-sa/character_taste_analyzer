import { accountExportDocumentSchema } from "./account-response";
import {
  darkBaselineUnderstandingSchema,
  darkScopeAssessmentSchema,
  darkUnderstandingCandidateSchema,
} from "./dark-understanding";
import {
  darkGeneratedCharacterCandidateSchema,
  generatedCharacterCandidateSchema,
  generationValidationReportSchema,
} from "./generation";
import { generationBriefSchema } from "./generation-brief";
import { darkPreferenceCandidateSchema, preferenceCandidateSchema } from "./preference";
import { graphProjectionSchema } from "./profile-response";
import { understandingCandidateSchema } from "./understanding";

/** Published wire contracts. The runtime validators are their only source. */
export const publishedSchemas = {
  "character-understanding": understandingCandidateSchema,
  "preference-analysis": preferenceCandidateSchema,
  "generated-character": generatedCharacterCandidateSchema,
  "generation-brief.v2": generationBriefSchema,
  "graph-projection": graphProjectionSchema,
  "dark-scope-assessment": darkScopeAssessmentSchema,
  "dark-baseline-understanding": darkBaselineUnderstandingSchema,
  "dark-character-understanding": darkUnderstandingCandidateSchema,
  "dark-preference-analysis": darkPreferenceCandidateSchema,
  "dark-generated-character": darkGeneratedCharacterCandidateSchema,
  "generation-validation": generationValidationReportSchema,
  "account-export": accountExportDocumentSchema,
} as const;
