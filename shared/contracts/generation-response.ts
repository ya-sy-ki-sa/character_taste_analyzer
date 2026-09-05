import { z } from "zod";
import { anyGeneratedCharacterCandidateSchema, generationModeSchema } from "./generation";

export const generationOptionSchema = z
  .object({
    id: z.string(),
    ordinal: z.number(),
    character: anyGeneratedCharacterCandidateSchema,
    selected: z.boolean(),
    comparison: z.object({
      coherence: z.string(),
      preferenceFit: z.string(),
      difference: z.string(),
      tradeoffs: z.array(z.string()),
    }),
  })
  .meta({ id: "GenerationOption" });
export type GenerationOption = z.infer<typeof generationOptionSchema>;

export const feedbackRowSchema = z
  .object({
    id: z.string(),
    characterName: z.string(),
    outputExcerpt: z.unknown(),
    reason: z.string(),
    status: z.string(),
    preference: z.object({ label: z.string(), polarity: z.string(), responseChannel: z.string(), scope: z.string() }),
  })
  .meta({ id: "FeedbackRow" });
export type FeedbackRow = z.infer<typeof feedbackRowSchema>;

export const feedbackResponseSchema = z
  .object({
    feedback: z.array(feedbackRowSchema),
    attributes: z.array(z.object({ stableKey: z.string(), label: z.string() })),
  })
  .meta({ id: "FeedbackResponse" });
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;

export const generationSnapshotItemSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    stableKey: z.string(),
    label: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "GenerationSnapshotItem" });
export type GenerationSnapshotItem = z.infer<typeof generationSnapshotItemSchema>;

export const snapshotResponseSchema = z
  .object({
    snapshot: z.union([z.object({ id: z.string(), generation: z.number() }), z.null()]),
    items: z.array(generationSnapshotItemSchema),
  })
  .meta({ id: "SnapshotResponse" });
export type SnapshotResponse = z.infer<typeof snapshotResponseSchema>;

export const generationRowSchema = z
  .object({
    id: z.union([z.string(), z.null()]),
    generationRequestId: z.string(),
    status: z.string(),
    mode: generationModeSchema,
    createdAt: z.string(),
    character: z.union([anyGeneratedCharacterCandidateSchema, z.null()]),
    candidates: z.array(generationOptionSchema),
    job: z.object({ status: z.union([z.string(), z.null()]), errorCode: z.union([z.string(), z.null()]) }),
  })
  .meta({ id: "GenerationRow" });
export type GenerationRow = z.infer<typeof generationRowSchema>;

export const generationListSchema = z
  .object({ generations: z.array(generationRowSchema) })
  .meta({ id: "GenerationList" });
export const generationCreationSchema = z
  .object({
    generationRequestId: z.string(),
    status: z.string(),
    jobId: z.string(),
    replayed: z.boolean(),
    outboxEventId: z.string().optional(),
  })
  .meta({ id: "GenerationCreation" });
export const candidateSelectionResultSchema = z
  .object({ candidateId: z.string(), generatedCharacterId: z.string() })
  .meta({ id: "CandidateSelectionResult" });
export const feedbackCreationSchema = z
  .object({ id: z.string(), replayed: z.boolean() })
  .meta({ id: "FeedbackCreation" });
export const feedbackReviewResultSchema = z
  .object({ status: z.string(), outboxEventId: z.string().nullable() })
  .meta({ id: "FeedbackReviewResult" });
export type GenerationList = z.infer<typeof generationListSchema>;
export type GenerationCreation = z.infer<typeof generationCreationSchema>;
export type CandidateSelectionResult = z.infer<typeof candidateSelectionResultSchema>;
export type FeedbackCreation = z.infer<typeof feedbackCreationSchema>;
export type FeedbackReviewResult = z.infer<typeof feedbackReviewResultSchema>;
