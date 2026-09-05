import { z } from "zod";

const count = z.number().int().nonnegative();
export const understandingEvidenceSummarySchema = z
  .object({
    assertionCount: count,
    assertionsWithoutEvidence: count,
    counts: z.object({
      sourceQuote: count,
      userInputQuote: count,
      userConfirmation: count,
      sourceAttributed: count,
      modelKnowledge: count,
      invalid: count,
      unclassified: count,
    }),
  })
  .meta({ id: "UnderstandingEvidenceSummary" });
export type UnderstandingEvidenceSummary = z.infer<typeof understandingEvidenceSummarySchema>;
