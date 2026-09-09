import { z } from "zod";
import { evidenceReferenceSchema } from "./evidence";
import { preferenceCandidateSchema } from "./preference";
import { understandingAuditSchema } from "./understanding-quality";

export const semanticSupportSchema = z.object({
  verdict: z.enum(["supported", "partial", "unsupported", "contradicted", "unverifiable"]),
  reason: z.string().trim().min(1).max(500),
});
export const scopedPropositionSchema = z.object({
  verdict: z.enum(["consistent", "mismatch", "uncertain"]),
  reason: z.string().trim().min(1).max(500),
  actor: z.string().max(300).nullable(),
  target: z.string().max(300).nullable(),
  possessor: z.string().max(300).nullable(),
  evaluatedProposition: z.string().max(1_000),
  negatedProposition: z.string().max(1_000).nullable(),
  anchors: z.array(evidenceReferenceSchema).max(3),
});
export const auditedEvidenceSchema = evidenceReferenceSchema.safeExtend({ supportAssessment: semanticSupportSchema });
export const evidenceSetAssessmentSchema = semanticSupportSchema.extend({
  evidenceIndexes: z.array(z.number().int().min(0).max(2)).max(3),
});
const auditFields = {
  // Require a decision in generated output while accepting historical/replay audits.
  evidenceSetAssessment: evidenceSetAssessmentSchema.nullable().default(null),
  scopeAssessment: scopedPropositionSchema,
  evidence: z.array(auditedEvidenceSchema).max(3),
};
export const groundedUnderstandingAuditSchema = understandingAuditSchema.safeExtend({
  assertions: z.array(understandingAuditSchema.shape.assertions.element.extend(auditFields)).max(100),
});
export const groundedPreferenceAuditSchema = preferenceCandidateSchema.extend({
  preferenceAssertions: z
    .array(preferenceCandidateSchema.shape.preferenceAssertions.element.extend(auditFields))
    .max(100),
  valueStanceAssertions: z
    .array(preferenceCandidateSchema.shape.valueStanceAssertions.element.extend(auditFields))
    .max(100),
});
export type GroundedUnderstandingAudit = z.infer<typeof groundedUnderstandingAuditSchema>;
export type GroundedPreferenceAudit = z.infer<typeof groundedPreferenceAuditSchema>;
export type ScopedProposition = z.infer<typeof scopedPropositionSchema>;
export type AuditedEvidence = z.infer<typeof auditedEvidenceSchema>;

export type EvidenceSetAssessment = z.infer<typeof evidenceSetAssessmentSchema>;
