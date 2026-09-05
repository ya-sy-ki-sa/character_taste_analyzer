import { z } from "zod";

export const jobViewSchema = z
  .object({
    id: z.string(),
    job_type: z.string(),
    status: z.string(),
    target_type: z.string(),
    target_id: z.string(),
    progress_current: z.number(),
    progress_total: z.number(),
    current_step: z.string().nullable(),
    retryable: z.number(),
    error_code: z.string().nullable(),
    error_detail_safe: z.string().nullable(),
    result_ref_json: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    completed_at: z.string().nullable(),
  })
  .meta({ id: "JobView" });
export const jobResponseSchema = z.object({ job: jobViewSchema }).meta({ id: "JobResponse" });
export const jobRetryResultSchema = z
  .union([
    z.object({
      jobId: z.string(),
      generationRequestId: z.string(),
      inputGeneration: z.number(),
      outboxEventId: z.string(),
      status: z.literal("queued"),
    }),
    z.object({
      jobId: z.string(),
      entryId: z.string(),
      stage: z.enum(["understanding", "preference"]),
      inputGeneration: z.number(),
      outboxEventId: z.string(),
      status: z.literal("queued"),
    }),
  ])
  .meta({ id: "JobRetryResult" });
export type JobView = z.infer<typeof jobViewSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type JobRetryResult = z.infer<typeof jobRetryResultSchema>;
