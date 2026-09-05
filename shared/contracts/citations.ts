import { z } from "zod";

export const citationIssueSchema = z.object({
  reason: z.enum([
    "unknown_source_ref",
    "url_not_allowed",
    "conflicting_reference",
    "source_unavailable",
    "quote_not_found",
  ]),
  sourceRef: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  inputPointer: z.string().nullable(),
  targetType: z.enum(["character_assertion", "preference_assertion", "value_stance_assertion"]),
  targetId: z.string(),
  evidenceIndex: z.number().int().nonnegative(),
  modelRunId: z.string(),
});

export type CitationIssue = z.infer<typeof citationIssueSchema>;
