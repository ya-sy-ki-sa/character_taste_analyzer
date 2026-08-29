import { z } from "zod";
import { TRAITS } from "./taxonomy";

const traitIds = TRAITS.map(([id]) => id) as [string, ...string[]];
export const traitIdSchema = z.enum(traitIds);

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export const usernameSchema = z
  .string()
  .trim()
  .min(1, "ユーザー名を入力してください")
  .max(32, "ユーザー名は32文字以内です")
  .refine((value) => !containsControlCharacter(value), "制御文字は使用できません");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const preferenceFields = {
  preferenceRating: z.number().int().min(1).max(5).optional(),
  likedAspects: optionalText(2_000),
  dislikedAspects: optionalText(2_000),
};

export const existingEntrySchema = z.object({
  kind: z.literal("existing"),
  workTitle: z.string().trim().min(1).max(120),
  characterName: z.string().trim().min(1).max(120),
  overview: z.string().trim().min(1, "キャラクター概要を入力してください").max(10_000),
  mediumOrEdition: optionalText(120),
  ...preferenceFields,
});

export const originalEntrySchema = z.object({
  kind: z.literal("original"),
  characterName: optionalText(120),
  overview: z.string().trim().min(1, "キャラクター概要を入力してください").max(10_000),
  ...preferenceFields,
});

export const characterEntryInputSchema = z.discriminatedUnion("kind", [existingEntrySchema, originalEntrySchema]);

export type CharacterEntryInput = z.infer<typeof characterEntryInputSchema>;

export const evidenceFieldSchema = z.enum(["overview", "likedAspects", "dislikedAspects"]);

export const traitAssertionSchema = z.object({
  traitId: traitIdSchema,
  level: z.number().int().min(0).max(4).nullable(),
  observation: z.enum(["stated", "inferred"]),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    field: evidenceFieldSchema,
    quote: z.string().min(1).max(300),
  }),
});

export const extractedPreferenceSchema = z.object({
  traitId: traitIdSchema,
  polarity: z.enum(["positive", "negative"]),
  strength: z.number().min(0).max(1),
  evidence: z.object({
    field: z.enum(["likedAspects", "dislikedAspects"]),
    quote: z.string().min(1).max(300),
  }),
});

export const traitExtractionSchema = z.object({
  assertions: z.array(traitAssertionSchema).max(40),
  preferences: z.array(extractedPreferenceSchema).max(20),
  freeTags: z.array(z.object({ label: z.string().min(1).max(40), evidenceQuote: z.string().min(1).max(300) })).max(10),
});

export type TraitExtraction = z.infer<typeof traitExtractionSchema>;

export const profileSummarySchema = z.object({
  summary: z.string().min(1).max(1_000),
});

export const generationModeSchema = z.enum(["faithful", "balanced", "surprising"]);

export const generatedCharacterSchema = z.object({
  name: z.string().min(1).max(80),
  concept: z.string().min(1).max(400),
  appearance: z.string().min(1).max(1_200),
  personality: z.string().min(1).max(1_200),
  valuesAndMotivation: z.string().min(1).max(1_200),
  abilitiesAndWeaknesses: z.string().min(1).max(1_200),
  background: z.string().min(1).max(1_500),
  centralConflict: z.string().min(1).max(1_000),
  relationships: z.string().min(1).max(1_200),
  voiceAndMannerisms: z.string().min(1).max(800),
  storyHooks: z.array(z.string().min(1).max(500)).min(2).max(5),
  tasteRationale: z.array(z.object({ traitId: traitIdSchema, reason: z.string().min(1).max(400) })).max(8),
  explorationNotes: z.array(z.string().min(1).max(400)).max(4),
  safetyNotes: z.array(z.string().min(1).max(300)).max(4),
});

export type GeneratedCharacter = z.infer<typeof generatedCharacterSchema>;

export const generationRequestSchema = z.object({
  mode: generationModeSchema.default("balanced"),
  requestNote: optionalText(1_000),
});

export const feedbackInputSchema = z
  .object({
    overallRating: z.number().int().min(1).max(5).optional(),
    likedTraitIds: z.array(traitIdSchema).max(20).optional(),
    dislikedTraitIds: z.array(traitIdSchema).max(20).optional(),
    intensityAdjustments: z
      .array(z.object({ traitId: traitIdSchema, direction: z.enum(["stronger", "weaker"]) }))
      .max(20)
      .optional(),
    comment: optionalText(2_000),
  })
  .refine(
    (value) =>
      value.overallRating !== undefined ||
      Boolean(value.likedTraitIds?.length) ||
      Boolean(value.dislikedTraitIds?.length) ||
      Boolean(value.intensityAdjustments?.length) ||
      Boolean(value.comment),
    "フィードバックを送信する場合は1項目以上入力してください",
  );

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const feedbackCommentExtractionSchema = z.object({
  signals: z
    .array(
      z.object({
        traitId: traitIdSchema,
        polarity: z.enum(["positive", "negative"]),
        strength: z.number().min(0).max(1),
        evidenceQuote: z.string().min(1).max(300),
      }),
    )
    .max(20),
});

export const correctionInputSchema = z.object({
  traitId: traitIdSchema,
  action: z.enum(["confirm", "reject", "replace"]),
  replacementTraitId: traitIdSchema.optional(),
  preference: z.enum(["positive", "negative", "neutral"]).optional(),
  level: z.number().int().min(0).max(4).nullable().optional(),
  note: optionalText(500),
});

export type CorrectionInput = z.infer<typeof correctionInputSchema>;

export const registrationSchema = z.object({
  username: usernameSchema,
  turnstileToken: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const activationSchema = z.object({ accessKey: z.string().uuid() });
export const loginSchema = z.object({
  userId: z.string().uuid(),
  accessKey: z.string().uuid(),
  turnstileToken: z.string().optional(),
});

export type ApiError = { code: string; message: string; requestId: string; details?: unknown };

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "superseded";

export type ProfileTrait = {
  traitId: string;
  label: string;
  category: string;
  occurrenceWeight: number;
  evidenceCount: number;
  positiveWeight: number;
  negativeWeight: number;
  preferenceMean: number | null;
  confidence: "hypothesis" | "candidate" | "moderate" | "strong";
  contradictory: boolean;
  evidenceIds: string[];
};

export type ProfileCluster = {
  id: string;
  label: string;
  entryIds: string[];
  representativeTraitIds: string[];
};

export type TasteProfile = {
  version: number;
  provisional: boolean;
  entryCount: number;
  summary: string;
  frequentTraits: ProfileTrait[];
  explicitLikes: ProfileTrait[];
  explicitDislikes: ProfileTrait[];
  contradictions: ProfileTrait[];
  clusters: ProfileCluster[];
  generatedAt: string;
};
