import { z } from "zod";
import { evidenceReferenceSchema, preferenceAssertionContextSchema } from "./evidence";
import {
  darkResponseChannelSchema,
  responseChannelSchema,
  valueOrientationSchema,
  valueStanceSchema,
} from "./taxonomy";

export const preferenceCandidateSchema = z.object({
  summary: z.object({
    userExplicitSummary: z.array(z.string().max(1_000)).max(50),
    inferredSummary: z.array(z.string().max(1_000)).max(50),
    limitations: z.array(z.string().max(1_000)).max(50),
  }),
  preferenceAssertions: z
    .array(
      z.object({
        attributeStableKey: z
          .string()
          .regex(/^[a-z0-9_.-]+$/u)
          .max(150)
          .nullable(),
        rawLabel: z.string().min(1).max(200),
        polarity: z.enum(["positive", "negative", "mixed"]),
        responseChannel: responseChannelSchema,
        strength: z.number().min(0).max(1),
        explicitness: z.enum(["user_explicit", "user_confirmed", "inferred", "model_knowledge"]),
        confidence: z.number().min(0).max(1),
        context: preferenceAssertionContextSchema,
        evidence: z.array(evidenceReferenceSchema).max(3),
      }),
    )
    .max(100),
  valueStanceAssertions: z
    .array(
      z.object({
        targetType: z.enum(["attribute", "value", "action", "role", "outcome", "expression"]),
        targetRef: z.string().min(1).max(1_000),
        stance: valueStanceSchema,
        orientation: valueOrientationSchema,
        context: preferenceAssertionContextSchema,
        explicitness: z.enum(["user_explicit", "user_confirmed", "inferred"]),
        confidence: z.number().min(0).max(1),
        evidence: z.array(evidenceReferenceSchema).max(3),
      }),
    )
    .max(100),
  uncertainties: z
    .array(
      z.object({
        topic: z.string().min(1).max(500),
        reason: z.string().min(1).max(2_000),
        recommendedQuestion: z.string().trim().min(1).max(500).nullable(),
      }),
    )
    .max(50),
});

export type PreferenceCandidate = z.infer<typeof preferenceCandidateSchema>;

export const darkPreferenceCandidateSchema = preferenceCandidateSchema.extend({
  preferenceAssertions: z
    .array(
      z.object({
        attributeStableKey: z
          .string()
          .regex(/^dark\.[a-z0-9_.-]+$/u)
          .max(150)
          .nullable(),
        rawLabel: z.string().min(1).max(200),
        polarity: z.enum(["positive", "negative", "mixed"]),
        responseChannel: darkResponseChannelSchema,
        strength: z.number().min(0).max(1),
        explicitness: z.enum(["user_explicit", "user_confirmed", "inferred", "model_knowledge"]),
        confidence: z.number().min(0).max(1),
        context: preferenceAssertionContextSchema,
        evidence: z.array(evidenceReferenceSchema).max(3),
      }),
    )
    .max(100),
  auditNotes: z.array(z.string().max(1_000)).max(50),
});

export type DarkPreferenceCandidate = z.infer<typeof darkPreferenceCandidateSchema>;

export type AnyPreferenceCandidate = PreferenceCandidate | DarkPreferenceCandidate;
