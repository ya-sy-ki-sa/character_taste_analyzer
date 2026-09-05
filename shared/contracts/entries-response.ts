import { z } from "zod";
import { registrationTypeSchema } from "./taxonomy";

export const entrySummarySchema = z
  .object({
    id: z.string(),
    registrationType: registrationTypeSchema,
    status: z.string(),
    title: z.string(),
    subtitle: z.string(),
    activeRevisionNumber: z.number(),
    updatedAt: z.string(),
    reviewTargetId: z.union([z.string(), z.null()]),
    job: z.union([
      z.object({
        id: z.string(),
        status: z.string(),
        retryable: z.boolean(),
        currentStep: z.union([z.string(), z.null()]),
        progressCurrent: z.number(),
        progressTotal: z.number(),
        errorCode: z.union([z.string(), z.null()]),
        errorDetail: z.union([z.string(), z.null()]),
      }),
      z.null(),
    ]),
  })
  .meta({ id: "EntrySummary" });
export type EntrySummary = z.infer<typeof entrySummarySchema>;

export const entryListSchema = z.object({ entries: z.array(entrySummarySchema) }).meta({ id: "EntryList" });
export type EntryList = z.infer<typeof entryListSchema>;
export const entryCreationSchema = z
  .object({
    entryId: z.string(),
    jobId: z.string(),
    status: z.string(),
    replayed: z.boolean(),
    outboxEventId: z.string().optional(),
    profileOutboxEventId: z.string().optional(),
  })
  .meta({ id: "EntryCreation" });
export const entryReanalysisResultSchema = entryCreationSchema
  .extend({ entryRevisionId: z.string(), revisionNumber: z.number() })
  .meta({ id: "EntryReanalysisResult" });
export type EntryCreation = z.infer<typeof entryCreationSchema>;
export type EntryReanalysisResult = z.infer<typeof entryReanalysisResultSchema>;
export const identityCandidateSchema = z
  .object({
    workId: z.string().nullable(),
    characterIdentityId: z.string(),
    workTitle: z.string().nullable(),
    characterName: z.string(),
    mediaType: z.string().nullable(),
    match: z.enum(["exact", "work_and_character"]),
  })
  .meta({ id: "IdentityCandidate" });
export const identityCandidatesSchema = z
  .object({ candidates: z.array(identityCandidateSchema) })
  .meta({ id: "IdentityCandidates" });
export type IdentityCandidates = z.infer<typeof identityCandidatesSchema>;
export const understandingMutationResultSchema = z
  .object({ snapshotId: z.string(), changedId: z.string(), action: z.string(), replayed: z.boolean() })
  .meta({ id: "UnderstandingMutationResult" });
export const understandingConfirmationSchema = z
  .object({ entryId: z.string(), status: z.literal("analyzing"), jobId: z.string() })
  .meta({ id: "UnderstandingConfirmation" });
export const preferenceMutationResultSchema = z
  .union([
    z.object({ analysisRunId: z.string(), changedId: z.string(), action: z.string(), replayed: z.boolean() }),
    z.object({ analysisRunId: z.string(), targetId: z.string(), targetType: z.string(), replayed: z.boolean() }),
  ])
  .meta({ id: "PreferenceMutationResult" });
export const preferenceActivationSchema = z
  .object({
    entryId: z.string(),
    status: z.literal("active"),
    profileJobId: z.string(),
    outboxEventId: z.string(),
    freshness: z.object({
      status: z.literal("rebuilding"),
      desiredGeneration: z.number(),
      builtGeneration: z.number(),
    }),
  })
  .meta({ id: "PreferenceActivation" });
export const scopeReviewResultSchema = z
  .object({ entryId: z.string(), status: z.enum(["queued", "cancelled"]), outboxEventId: z.string().nullable() })
  .meta({ id: "ScopeReviewResult" });
export const refinementResultSchema = z
  .object({ id: z.string(), replayed: z.boolean(), outboxEventId: z.string().nullable(), jobId: z.string().optional() })
  .meta({ id: "RefinementResult" });
export type UnderstandingMutationResult = z.infer<typeof understandingMutationResultSchema>;
export type UnderstandingConfirmation = z.infer<typeof understandingConfirmationSchema>;
export type PreferenceMutationResult = z.infer<typeof preferenceMutationResultSchema>;
export type PreferenceActivation = z.infer<typeof preferenceActivationSchema>;
export type ScopeReviewResult = z.infer<typeof scopeReviewResultSchema>;
export type RefinementResult = z.infer<typeof refinementResultSchema>;
