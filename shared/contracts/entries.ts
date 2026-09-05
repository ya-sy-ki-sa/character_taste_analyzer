import { z } from "zod";
import { darkResponseChannelValues } from "../dark-response-channels";
import { responseChannelValues } from "../response-channels";
import { darkResponseChannelSchema, responseChannelSchema } from "./taxonomy";
import { optionalText, text } from "./validation";

export const preferenceInputSchema = z.object({
  likedReasons: optionalText(4_000),
  dislikedReasons: optionalText(4_000),
  responseChannels: z
    .array(responseChannelSchema)
    .max(responseChannelValues.length)
    .refine((values) => new Set(values).size === values.length, "同じ選択肢を重複して指定できません")
    .default([]),
  valueStanceNote: optionalText(2_000),
});

export type PreferenceInput = z.infer<typeof preferenceInputSchema>;

export const commonEntryFields = {
  preferenceContext: optionalText(2_000),
  referenceMaterial: optionalText(20_000),
  userCharacterView: optionalText(4_000),
  preference: preferenceInputSchema,
};

export const identityResolutionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new") }),
  z.object({
    mode: z.literal("reuse"),
    workId: z.string().uuid().nullable(),
    characterIdentityId: z.string().uuid(),
  }),
]);

export type IdentityResolution = z.infer<typeof identityResolutionSchema>;

export const existingEntryDraftSchema = z
  .object({
    ...commonEntryFields,
    registrationType: z.literal("existing"),
    workTitle: text(200),
    characterName: text(200),
    mediaType: optionalText(100),
    identityResolution: identityResolutionSchema,
  })
  .strict();

export const customizedExistingEntryDraftSchema = z
  .object({
    ...commonEntryFields,
    registrationType: z.literal("customized_existing"),
    workTitle: text(200),
    baseCharacterName: text(200),
    characterName: text(200),
    mediaType: optionalText(100),
    representationType: z.enum(["facet", "scene_state", "alternate_setting", "transformative", "user_interpretation"]),
    customizationDescription: text(8_000, "どのように基本像から異なるか入力してください"),
    identityResolution: identityResolutionSchema,
  })
  .strict();

export const originalEntryDraftSchema = z
  .object({
    ...commonEntryFields,
    registrationType: z.literal("original"),
    characterName: text(200),
    characterBasicInfo: text(20_000, "キャラクター基本情報を入力してください"),
  })
  .strict();

export const entrySubmissionSchema = z.discriminatedUnion("registrationType", [
  existingEntryDraftSchema,
  customizedExistingEntryDraftSchema,
  originalEntryDraftSchema,
]);

export const entryReanalysisSchema = z.object({ draft: entrySubmissionSchema });

export type EntryReanalysisInput = z.infer<typeof entryReanalysisSchema>;

export const entryDraftSchema = entrySubmissionSchema;

export type EntryDraft = z.infer<typeof entryDraftSchema>;

export type EntrySubmission = z.infer<typeof entrySubmissionSchema>;

export const darkArchetypeHintSchema = z.enum([
  "villain",
  "villain_protagonist",
  "antagonistic_rival",
  "antihero",
  "dark_hero",
  "morally_gray",
  "fallen_hero",
  "controlled_hero",
  "manipulated_former_ally",
  "betraying_ally",
  "other_dark",
]);

export const darkContextSchema = z
  .object({
    focusDescription: text(2_000, "注目するダーク状態・役割を入力してください"),
    archetypeHints: z.array(darkArchetypeHintSchema).max(10).default([]),
    beforeState: optionalText(4_000),
    transitionTrigger: optionalText(4_000),
    controllerOrInfluence: optionalText(2_000),
    controlMechanism: optionalText(2_000),
    awarenessAndResistance: optionalText(2_000),
    relationshipChange: optionalText(4_000),
    responsibilityNote: optionalText(2_000),
    desiredOutcome: optionalText(2_000),
    contentBoundaries: optionalText(2_000),
  })
  .strict();

export type DarkContext = z.infer<typeof darkContextSchema>;

export const darkPreferenceInputSchema = z.object({
  likedReasons: optionalText(4_000),
  dislikedReasons: optionalText(4_000),
  responseChannels: z
    .array(darkResponseChannelSchema)
    .max(darkResponseChannelValues.length)
    .refine((values) => new Set(values).size === values.length, "同じ選択肢を重複して指定できません")
    .default([]),
  valueStanceNote: optionalText(2_000),
});

export type DarkPreferenceInput = z.infer<typeof darkPreferenceInputSchema>;

export const darkCommonEntryFields = {
  preferenceContext: optionalText(2_000),
  referenceMaterial: optionalText(20_000),
  userCharacterView: optionalText(4_000),
  darkContext: darkContextSchema,
  preference: darkPreferenceInputSchema,
};

export const darkExistingEntryDraftSchema = z
  .object({
    ...darkCommonEntryFields,
    registrationType: z.literal("existing"),
    workTitle: text(200),
    characterName: text(200),
    mediaType: optionalText(100),
    identityResolution: identityResolutionSchema,
  })
  .strict();

export const darkCustomizedExistingEntryDraftSchema = z
  .object({
    ...darkCommonEntryFields,
    registrationType: z.literal("customized_existing"),
    workTitle: text(200),
    baseCharacterName: text(200),
    characterName: text(200),
    mediaType: optionalText(100),
    representationType: z.enum(["facet", "scene_state", "alternate_setting", "transformative", "user_interpretation"]),
    customizationDescription: text(8_000, "どのように基本像から異なるか入力してください"),
    identityResolution: identityResolutionSchema,
  })
  .strict();

export const darkOriginalEntryDraftSchema = z
  .object({
    ...darkCommonEntryFields,
    registrationType: z.literal("original"),
    characterName: text(200),
    characterBasicInfo: text(20_000, "キャラクター基本情報を入力してください"),
  })
  .strict();

export const darkEntrySubmissionSchema = z.discriminatedUnion("registrationType", [
  darkExistingEntryDraftSchema,
  darkCustomizedExistingEntryDraftSchema,
  darkOriginalEntryDraftSchema,
]);

export const darkEntryReanalysisSchema = z.object({ draft: darkEntrySubmissionSchema });

export type DarkEntryDraft = z.infer<typeof darkEntrySubmissionSchema>;

export type DarkEntrySubmission = DarkEntryDraft;

export type AnyEntryDraft = EntryDraft | DarkEntryDraft;

export type AnyEntrySubmission = EntrySubmission | DarkEntrySubmission;

export type AnyEntryReanalysisInput = { draft: AnyEntryDraft };

export const anyEntryDraftSchema = z.union([entryDraftSchema, darkEntrySubmissionSchema]);

export const identityCandidateRequestSchema = z.object({
  workTitle: text(200),
  characterName: text(200),
  mediaType: optionalText(100),
});

export type IdentityCandidateRequest = z.infer<typeof identityCandidateRequestSchema>;

export type IdentityCandidate = {
  workId: string | null;
  characterIdentityId: string;
  workTitle: string | null;
  characterName: string;
  mediaType: string | null;
  match: "exact" | "work_and_character";
};
