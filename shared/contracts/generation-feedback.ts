import { z } from "zod";
import { darkResponseChannelValues } from "../dark-response-channels";
import { responseChannelValues } from "../response-channels";

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
