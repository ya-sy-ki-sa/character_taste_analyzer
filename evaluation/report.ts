import { z } from "zod";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { generationRowSchema } from "../shared/contracts/generation-response";

const caseIdentity = { id: z.string().min(1), domain: z.enum(["standard", "dark"]) };
const generationSchema = z.object({
  brief: z.object({ brief_json: z.string() }),
  result: generationRowSchema,
  inspections: z.array(
    z.object({
      ordinal: z.number(),
      status: z.string(),
      character_json: z.string().nullable(),
      validation_json: z.string().nullable(),
      similarity_json: z.string().nullable(),
      comparison_json: z.string().nullable(),
    }),
  ),
});
export const successfulCaseSchema = z.object({
  ...caseIdentity,
  expectedChannels: z.array(z.string()),
  expectsEmpty: z.boolean(),
  assertions: z.array(
    z.object({
      response_channel: z.string(),
      polarity: z.string(),
      context_json: z.string(),
      explicitness: z.string(),
    }),
  ),
  generation: generationSchema.nullable(),
  generationSkippedReason: z.enum(["no_preferences", "no_selected_items"]).optional(),
  detail: reviewDetailSchema,
  modelRuns: z.array(
    z.object({
      operation: z.string(),
      requested_model: z.string(),
      resolved_model: z.string(),
      prompt_hash: z.string(),
      input_hash: z.string(),
      output_hash: z.string().nullable(),
      input_token_estimate: z.number().nullable(),
      output_token_estimate: z.number().nullable(),
      latency_ms: z.number(),
    }),
  ),
});
const failedCaseSchema = z.object({
  ...caseIdentity,
  error: z.string().min(1),
  jobs: z.array(
    z.object({ status: z.string(), error_code: z.string().nullable(), error_detail_safe: z.string().nullable() }),
  ),
});
export const qualityReportSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    fixtureVersion: z.string(),
    provider: z.enum(["fake", "openai", "replay"]),
    model: z.string(),
    createdAt: z.iso.datetime(),
    generationRequested: z.boolean(),
    results: z.array(z.union([successfulCaseSchema, failedCaseSchema])).min(1),
  })
  .superRefine((report, context) => {
    const ids = new Set<string>();
    report.results.forEach((result, index) => {
      if (ids.has(result.id))
        context.addIssue({ code: "custom", message: "Duplicate fixture ID", path: ["results", index, "id"] });
      ids.add(result.id);
      if ("error" in result) return;
      if (report.generationRequested && !result.generation && !result.generationSkippedReason)
        context.addIssue({
          code: "custom",
          message: "Requested generation must have a result or an explicit skip reason",
          path: ["results", index, "generation"],
        });
    });
  });
export type QualityReport = z.infer<typeof qualityReportSchema>;
export function caseFailed(result: QualityReport["results"][number]) {
  return (
    "error" in result ||
    (result.generation !== null &&
      (result.generation.result.status !== "generated" || result.generation.result.candidates.length === 0))
  );
}
