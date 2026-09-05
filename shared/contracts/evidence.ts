import { z } from "zod";

export const evidenceReferenceSchema = z
  .object({
    sourceRef: z.string().min(1).max(200).nullable(),
    sourceUrl: z.string().url().max(1_000).nullable(),
    inputPointer: z.string().startsWith("/").max(500).nullable(),
    quote: z.string().min(1).max(500).nullable(),
    inferenceType: z.enum(["direct", "paraphrase", "inferred"]),
  })
  .superRefine((evidence, context) => {
    if (!evidence.sourceRef && !evidence.sourceUrl && !evidence.inputPointer)
      context.addIssue({ code: "custom", message: "evidenceには参照元が必要です" });
    if (evidence.inferenceType === "direct" && !evidence.quote)
      context.addIssue({ code: "custom", path: ["quote"], message: "direct evidenceには引用が必要です" });
  });

export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const preferenceAssertionContextSchema = z.object({
  schemaVersion: z.literal("2"),
  entryScope: z.string().max(1_000).nullable(),
  subjects: z.array(z.string().min(1).max(300)).max(10),
  relationships: z.array(z.string().min(1).max(300)).max(10),
  narrativePhases: z.array(z.string().min(1).max(300)).max(10),
  conditions: z.array(z.string().min(1).max(500)).max(10),
  exceptions: z.array(z.string().min(1).max(500)).max(10),
});

export type PreferenceAssertionContext = z.infer<typeof preferenceAssertionContextSchema>;
