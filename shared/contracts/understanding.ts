import { z } from "zod";
import { evidenceReferenceSchema } from "./evidence";

export const sourceAssessmentSchema = z.object({
  coverage: z.enum(["sufficient", "partial", "minimal", "none"]),
  limitations: z.array(z.string().max(1_000)).max(50),
  modelKnowledgeUsed: z.boolean(),
});

export const understandingSummarySchema = z.object({
  identity: z.string().min(1).max(2_000),
  narrativeRole: z.array(z.string().max(200)).max(20),
  moralityOrientation: z.array(z.string().max(200)).max(20),
  goals: z.array(z.string().max(500)).max(30),
  values: z.array(z.string().max(500)).max(30),
  behavior: z.array(z.string().max(500)).max(50),
  relationships: z.array(z.string().max(500)).max(50),
  expression: z.array(z.string().max(500)).max(50),
});

export const understandingCandidateSchema = z.object({
  sourceAssessment: sourceAssessmentSchema,
  summary: understandingSummarySchema,
  assertions: z
    .array(
      z.object({
        attributeStableKey: z
          .string()
          .regex(/^[a-z0-9_.-]+$/u)
          .max(150)
          .nullable(),
        rawLabel: z.string().min(1).max(200),
        valueText: z.string().min(1).max(2_000),
        assertionKind: z.enum(["setting", "observable_behavior", "source_interpretation", "user_interpretation"]),
        scopeText: z.string().max(1_000),
        explicitness: z.enum(["source_explicit", "source_interpreted", "user_explicit", "model_knowledge"]),
        confidence: z.number().min(0).max(1),
        evidence: z.array(evidenceReferenceSchema).max(3),
      }),
    )
    .max(100),
  customizationDeltas: z
    .array(
      z
        .object({
          operation: z.enum([
            "inherit",
            "add",
            "modify",
            "remove",
            "invert",
            "narrow_scope",
            "emphasize",
            "unspecified",
          ]),
          targetAttributeStableKey: z
            .string()
            .regex(/^[a-z0-9_.-]+$/u)
            .max(150)
            .nullable(),
          beforeValue: z.string().max(2_000).nullable(),
          afterValue: z.string().max(2_000).nullable(),
          scopeText: z.string().max(1_000),
          reasonText: z.string().max(2_000).nullable(),
          explicitness: z.enum(["user_explicit", "inferred"]),
          confidence: z.number().min(0).max(1),
        })
        .superRefine((delta, context) => {
          if (delta.operation === "add" && (delta.beforeValue !== null || delta.afterValue === null))
            context.addIssue({ code: "custom", message: "addにはafterValueだけが必要です" });
          if (delta.operation === "remove" && (delta.beforeValue === null || delta.afterValue !== null))
            context.addIssue({ code: "custom", message: "removeにはbeforeValueだけが必要です" });
          if (
            ["modify", "invert"].includes(delta.operation) &&
            (delta.beforeValue === null || delta.afterValue === null)
          )
            context.addIssue({ code: "custom", message: "modify/invertにはbeforeValueとafterValueが必要です" });
        }),
    )
    .max(100),
  uncertainties: z.array(z.object({ topic: z.string().min(1).max(500), reason: z.string().min(1).max(2_000) })).max(50),
});

export type UnderstandingCandidate = z.infer<typeof understandingCandidateSchema>;
