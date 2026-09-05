import { z } from "zod";
import { darkStateModelSchema } from "./dark-understanding";
import { anyEntryDraftSchema } from "./entries";
import { hypothesisPreviewSchema } from "./refinement";
import { registrationTypeSchema } from "./taxonomy";

const understandingSummaryViewSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()), darkStateModelSchema]),
);

export const evidenceDetailSchema = z
  .object({
    id: z.string(),
    verificationStatus: z.string(),
    inferenceType: z.string(),
    quote: z.union([z.string(), z.null()]),
    inputPointer: z.union([z.string(), z.null()]),
    sourceTitle: z.union([z.string(), z.null()]),
    sourceUrl: z.union([z.string(), z.null()]),
    sourceProvider: z.union([z.string(), z.null()]),
    trustReason: z.union([z.string(), z.null()]),
    canNavigate: z.boolean(),
  })
  .meta({ id: "EvidenceDetail" });
export type EvidenceDetail = z.infer<typeof evidenceDetailSchema>;

export const customizationDeltaDetailSchema = z
  .object({
    id: z.string(),
    operation: z.string(),
    before_value: z.union([z.string(), z.null()]),
    after_value: z.union([z.string(), z.null()]),
    reason_text: z.union([z.string(), z.null()]),
    confidence: z.number(),
    status: z.string(),
  })
  .meta({ id: "CustomizationDeltaDetail" });
export type CustomizationDeltaDetail = z.infer<typeof customizationDeltaDetailSchema>;

export const characterAssertionDetailSchema = z
  .object({
    id: z.string(),
    raw_label: z.string(),
    value_text: z.string(),
    explicitness: z.string(),
    confidence: z.number(),
    status: z.string(),
    evidence: z.array(evidenceDetailSchema),
    stable_key: z.union([z.string(), z.null()]),
  })
  .meta({ id: "CharacterAssertionDetail" });
export type CharacterAssertionDetail = z.infer<typeof characterAssertionDetailSchema>;

export const reviewDetailSchema = z
  .object({
    entry: z.object({
      id: z.string(),
      status: z.string(),
      registrationType: registrationTypeSchema,
      draft: anyEntryDraftSchema,
    }),
    darkScopeAssessment: z.union([
      z.null(),
      z.object({
        id: z.string(),
        verdict: z.string(),
        status: z.string(),
        assessment: z.object({
          rationale: z.string(),
          limitations: z.array(z.string()),
          recommendedQuestions: z.array(z.string()),
        }),
      }),
    ]),
    darkBaseline: z.union([z.null(), z.intersection(z.object({ id: z.string() }), z.record(z.string(), z.unknown()))]),
    darkTransformationDeltas: z.array(
      z.object({
        id: z.string(),
        operation: z.string(),
        aspect: z.string(),
        before_value: z.union([z.string(), z.null()]),
        after_value: z.union([z.string(), z.null()]),
        confidence: z.number(),
        detail: z.record(z.string(), z.unknown()),
      }),
    ),
    ontologyAttributes: z.array(z.object({ stableKey: z.string(), label: z.string() })),
    understanding: z.union([
      z.null(),
      z.object({
        id: z.string(),
        sourceAssessment: z.object({ coverage: z.string(), limitations: z.array(z.string()) }),
        summary: understandingSummaryViewSchema,
        uncertainties: z.array(z.object({ topic: z.string(), reason: z.string() })),
        confidence: z.number(),
        assertions: z.array(characterAssertionDetailSchema),
        deltas: z.array(customizationDeltaDetailSchema),
      }),
    ]),
    baseUnderstanding: z.union([
      z.null(),
      z.object({
        id: z.string(),
        sourceAssessment: z.object({ coverage: z.string(), limitations: z.array(z.string()) }),
        summary: understandingSummaryViewSchema,
        uncertainties: z.array(z.object({ topic: z.string(), reason: z.string() })),
        confidence: z.number(),
        assertions: z.array(characterAssertionDetailSchema),
      }),
    ]),
    preferenceAnalysis: z.union([
      z.null(),
      z.object({
        id: z.string(),
        hypothesisPreview: z.union([hypothesisPreviewSchema, z.null()]).optional(),
        qualityContext: z
          .object({ refinementMode: z.string().nullable().optional(), evidenceInsufficient: z.boolean().optional() })
          .optional(),
        summary: z.object({
          userExplicitSummary: z.array(z.string()),
          inferredSummary: z.array(z.string()),
          limitations: z.array(z.string()),
        }),
        uncertainties: z.array(
          z.object({ topic: z.string(), reason: z.string(), recommendedQuestion: z.union([z.string(), z.null()]) }),
        ),
        assertions: z.array(
          z.object({
            id: z.string(),
            raw_label: z.string(),
            polarity: z.string(),
            response_channel: z.string(),
            strength: z.number(),
            explicitness: z.string(),
            confidence: z.number(),
            status: z.string(),
            stable_key: z.union([z.string(), z.null()]),
            evidence: z.array(evidenceDetailSchema),
          }),
        ),
        valueStances: z.array(
          z.object({
            id: z.string(),
            target_ref: z.string(),
            stance: z.string(),
            orientation: z.string(),
            explicitness: z.string(),
            confidence: z.number(),
            status: z.string(),
            evidence: z.array(evidenceDetailSchema),
          }),
        ),
      }),
    ]),
  })
  .meta({ id: "ReviewDetail" });
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;
