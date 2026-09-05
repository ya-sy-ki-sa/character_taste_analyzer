import { z } from "zod";
import { darkResponseChannelValues } from "./dark-response-channels";
import { responseChannelValues } from "./response-channels";

export const preferenceRefinementSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("questions"),
    answers: z
      .array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(2000) }))
      .min(1)
      .max(3),
  }),
  z.object({ mode: z.literal("hypotheses") }),
  z.object({
    mode: z.literal("selection"),
    hypothesisBatchId: z.uuid(),
    selectedHypothesisIds: z
      .array(z.uuid())
      .min(1)
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
]);
export type PreferenceRefinement = z.infer<typeof preferenceRefinementSchema>;
export const preferenceHypothesisSchema = z.object({
  attributeStableKey: z.string().min(1).max(150),
  rawLabel: z.string().min(1).max(200),
  polarity: z.enum(["positive", "negative", "mixed"]),
  responseChannel: z.enum([...responseChannelValues, ...darkResponseChannelValues]),
  scope: z.string().max(1000),
  description: z.string().min(1).max(1000),
  reason: z.string().min(1).max(1000),
});
export type PreferenceHypothesis = z.infer<typeof preferenceHypothesisSchema> & { id: string };
export type HypothesisPreview = { id: string; candidates: PreferenceHypothesis[] | null };
export type RefinementContext = {
  schemaVersion: "2.1";
  baseAnalysisRunId: string;
  selectedHypotheses?: PreferenceHypothesis[];
  hypothesisBatchId?: string;
};
export const generationSelectionSchema = z.object({ candidateId: z.uuid() });
export const generationFeedbackSchema = z.object({
  candidateId: z.uuid(),
  outputPointer: z.string().min(1).max(500),
  reason: z.string().trim().min(1).max(2000),
  attributeStableKey: z.string().min(1).max(200),
  polarity: z.enum(["positive", "negative", "mixed"]),
  responseChannel: z.enum([...responseChannelValues, ...darkResponseChannelValues]),
  scope: z.string().trim().max(1000).default(""),
});
export type GenerationFeedbackInput = z.infer<typeof generationFeedbackSchema>;
export const feedbackReviewSchema = z.object({ decision: z.enum(["confirm", "reject"]) });
