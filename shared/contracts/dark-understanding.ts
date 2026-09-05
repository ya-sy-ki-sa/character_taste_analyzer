import { z } from "zod";
import { darkArchetypeHintSchema } from "./entries";
import { evidenceReferenceSchema } from "./evidence";
import { understandingCandidateSchema } from "./understanding";
import { optionalText } from "./validation";

export const darkScopeAssessmentSchema = z.object({
  verdict: z.enum(["in_scope", "borderline", "out_of_scope"]),
  qualifyingArchetypes: z.array(darkArchetypeHintSchema).max(10),
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  scope: z.enum(["whole_character", "phase", "form", "scene", "relationship", "unknown"]),
  rationale: z.string().min(1).max(3_000),
  limitations: z.array(z.string().max(1_000)).max(20),
  evidence: z.array(evidenceReferenceSchema).max(6),
  recommendedQuestions: z.array(z.string().max(500)).max(10),
});

export type DarkScopeAssessment = z.infer<typeof darkScopeAssessmentSchema>;

export const darkScopeReviewRequestSchema = z.object({
  decision: z.enum(["continue", "cancel"]),
  reasonText: optionalText(2_000),
});

export type DarkScopeReviewRequest = z.infer<typeof darkScopeReviewRequestSchema>;

export const darkStateModelSchema = z.object({
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  consent: z.enum(["chosen", "coerced", "unaware", "ambivalent", "unknown"]),
  awareness: z.enum(["aware", "partially_aware", "unaware", "unknown"]),
  resistance: z.enum(["active", "intermittent", "internal_only", "none", "unknown"]),
  identityContinuity: z.enum(["intact", "fragmented", "suppressed", "replaced", "unknown"]),
  responsibility: z.enum(["high", "reduced", "contested", "unknown"]),
  reversibility: z.enum(["reversible", "conditional", "irreversible", "unknown"]),
  controllerOrInfluence: z.string().max(1_000).nullable(),
  mechanism: z.string().max(1_000).nullable(),
  before: z.string().max(2_000).nullable(),
  onset: z.string().max(2_000).nullable(),
  activeState: z.string().min(1).max(3_000),
  recoveryOrAfter: z.string().max(2_000).nullable(),
});

export type DarkStateModel = z.infer<typeof darkStateModelSchema>;

export const darkBaselineUnderstandingSchema = z.object({
  identity: z.string().min(1).max(2_000),
  narrativeRole: z.array(z.string().max(500)).max(20),
  agency: z.array(z.string().max(500)).max(20),
  moralCommitments: z.array(z.string().max(500)).max(30),
  protectedPeopleOrValues: z.array(z.string().max(500)).max(30),
  relationships: z.array(z.string().max(500)).max(50),
  abilitiesAndDuties: z.array(z.string().max(500)).max(50),
  selfConcept: z.array(z.string().max(500)).max(30),
  priorVulnerabilities: z.array(z.string().max(500)).max(30),
  uncertainties: z.array(z.object({ topic: z.string().max(500), reason: z.string().max(2_000) })).max(50),
  evidence: z.array(evidenceReferenceSchema).max(30),
});

export type DarkBaselineUnderstanding = z.infer<typeof darkBaselineUnderstandingSchema>;

export const darkTransformationOperationSchema = z.enum([
  "retained",
  "amplified",
  "suppressed",
  "inverted",
  "removed",
  "introduced",
  "ambiguous",
]);

export const darkTransformationDeltaSchema = z.object({
  operation: darkTransformationOperationSchema,
  aspect: z.string().min(1).max(500),
  beforeValue: z.string().max(2_000).nullable(),
  afterValue: z.string().max(2_000).nullable(),
  cause: z.string().max(1_000).nullable(),
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  controller: z.string().max(1_000).nullable(),
  awareness: z.enum(["aware", "partially_aware", "unaware", "unknown"]),
  resistance: z.enum(["active", "intermittent", "internal_only", "none", "unknown"]),
  identityContinuity: z.enum(["intact", "fragmented", "suppressed", "replaced", "unknown"]),
  responsibility: z.enum(["high", "reduced", "contested", "unknown"]),
  reversibility: z.enum(["reversible", "conditional", "irreversible", "unknown"]),
  phase: z.enum(["before", "onset", "active", "recovery", "after", "unknown"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceReferenceSchema).max(3),
});

export type DarkTransformationDelta = z.infer<typeof darkTransformationDeltaSchema>;

export const darkUnderstandingCandidateSchema = understandingCandidateSchema.extend({
  darkState: darkStateModelSchema,
  transformationDeltas: z.array(darkTransformationDeltaSchema).max(100),
  auditNotes: z.array(z.string().max(1_000)).max(50),
});

export type DarkUnderstandingCandidate = z.infer<typeof darkUnderstandingCandidateSchema>;
