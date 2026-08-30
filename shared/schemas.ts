import { z } from "zod";
import { type ResponseChannel, responseChannelValues } from "./response-channels";

export type { ResponseChannel } from "./response-channels";

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return (point <= 0x1f && point !== 0x09 && point !== 0x0a) || point === 0x7f;
  });
}

const text = (maximum: number, message = "入力してください") =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(maximum)
    .refine((value) => !containsForbiddenControl(value), "制御文字は使用できません");
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

export const usernameSchema = text(32, "ユーザー名を入力してください");
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
export const keyRotationSchema = z.object({ currentAccessKey: z.string().uuid() });
export const accountDeletionSchema = z.object({ usernameConfirmation: usernameSchema });

export const registrationTypeSchema = z.enum(["existing", "customized_existing", "original"]);
export type RegistrationType = z.infer<typeof registrationTypeSchema>;
export const responseChannelSchema = z.enum(responseChannelValues);
export const valueOrientationSchema = z.enum([
  "evil",
  "immoral",
  "indifferent_to_good",
  "transgressive",
  "self_defined",
  "good",
  "mixed",
]);
export const valueStanceSchema = z.enum(["affirm", "accept", "indifferent", "ambivalent", "reject", "unspecified"]);

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

export const entryReanalysisSchema = z.object({ preference: preferenceInputSchema });
export type EntryReanalysisInput = z.infer<typeof entryReanalysisSchema>;
const commonEntry = {
  schemaVersion: z.literal("1"),
  preferenceContext: optionalText(2_000),
  /** @deprecated 旧ローカルデータの読込み専用。新規入力にはpreferenceContextを使用する。 */
  knownScope: optionalText(2_000),
  referenceMaterial: optionalText(20_000),
  /** @deprecated 旧ローカルデータの読込み専用。新規入力にはreferenceMaterialを使用する。 */
  sourceText: optionalText(20_000),
  userCharacterView: optionalText(4_000),
  preference: preferenceInputSchema,
};
export const existingEntryDraftSchema = z.object({
  ...commonEntry,
  registrationType: z.literal("existing"),
  workTitle: text(200),
  characterName: text(200),
  mediaType: optionalText(100),
});
export const customizedExistingEntryDraftSchema = z.object({
  ...commonEntry,
  registrationType: z.literal("customized_existing"),
  workTitle: text(200),
  characterName: text(200),
  mediaType: optionalText(100),
  representationType: z.enum(["facet", "scene_state", "alternate_setting", "transformative", "user_interpretation"]),
  customizationDescription: text(8_000, "どのように基本像から異なるか入力してください"),
});
export const originalEntryDraftSchema = z.object({
  ...commonEntry,
  registrationType: z.literal("original"),
  characterName: text(200),
  characterBasicInfo: text(20_000, "キャラクター基本情報を入力してください"),
});
export const entryDraftSchema = z.discriminatedUnion("registrationType", [
  existingEntryDraftSchema,
  customizedExistingEntryDraftSchema,
  originalEntryDraftSchema,
]);
export type EntryDraft = z.infer<typeof entryDraftSchema>;

export function entryPreferenceContext(draft: EntryDraft): string | undefined {
  return draft.preferenceContext ?? draft.knownScope;
}

export function entryScopeText(draft: EntryDraft): string {
  return entryPreferenceContext(draft) ?? "キャラクター全体";
}

export function entryReferenceMaterial(draft: EntryDraft): string | undefined {
  return draft.referenceMaterial ?? draft.sourceText;
}

const sourceAssessmentSchema = z.object({
  coverage: z.enum(["sufficient", "partial", "minimal", "none"]),
  limitations: z.array(z.string().max(1_000)).max(50),
  modelKnowledgeUsed: z.boolean(),
});
const understandingSummarySchema = z.object({
  identity: z.string().min(1).max(2_000),
  narrativeRole: z.array(z.string().max(200)).max(20),
  moralityOrientation: z.array(z.string().max(200)).max(20),
  goals: z.array(z.string().max(500)).max(30),
  values: z.array(z.string().max(500)).max(30),
  behavior: z.array(z.string().max(500)).max(50),
  relationships: z.array(z.string().max(500)).max(50),
  expression: z.array(z.string().max(500)).max(50),
});
export const understandingCandidateSchema = z.object({
  sourceAssessment: sourceAssessmentSchema,
  summary: understandingSummarySchema,
  assertions: z
    .array(
      z.object({
        attributeStableKey: z
          .string()
          .regex(/^[a-z0-9_.-]+$/u)
          .max(150)
          .nullable(),
        rawLabel: z.string().min(1).max(200),
        valueText: z.string().min(1).max(2_000),
        assertionKind: z.enum(["setting", "observable_behavior", "source_interpretation", "user_interpretation"]),
        scopeText: z.string().max(1_000),
        explicitness: z.enum(["source_explicit", "source_interpreted", "user_explicit", "model_knowledge"]),
        confidence: z.number().min(0).max(1),
        evidenceQuote: z.string().max(500).nullable(),
      }),
    )
    .max(100),
  customizationDeltas: z
    .array(
      z
        .object({
          operation: z.enum([
            "inherit",
            "add",
            "modify",
            "remove",
            "invert",
            "narrow_scope",
            "emphasize",
            "unspecified",
          ]),
          targetAttributeStableKey: z
            .string()
            .regex(/^[a-z0-9_.-]+$/u)
            .max(150)
            .nullable(),
          beforeValue: z.string().max(2_000).nullable(),
          afterValue: z.string().max(2_000).nullable(),
          scopeText: z.string().max(1_000),
          reasonText: z.string().max(2_000).nullable(),
          explicitness: z.enum(["user_explicit", "inferred"]),
          confidence: z.number().min(0).max(1),
        })
        .superRefine((delta, context) => {
          if (delta.operation === "add" && (delta.beforeValue !== null || delta.afterValue === null))
            context.addIssue({ code: "custom", message: "addにはafterValueだけが必要です" });
          if (delta.operation === "remove" && (delta.beforeValue === null || delta.afterValue !== null))
            context.addIssue({ code: "custom", message: "removeにはbeforeValueだけが必要です" });
          if (
            ["modify", "invert"].includes(delta.operation) &&
            (delta.beforeValue === null || delta.afterValue === null)
          )
            context.addIssue({ code: "custom", message: "modify/invertにはbeforeValueとafterValueが必要です" });
        }),
    )
    .max(100),
  uncertainties: z.array(z.object({ topic: z.string().min(1).max(500), reason: z.string().min(1).max(2_000) })).max(50),
});
export type UnderstandingCandidate = z.infer<typeof understandingCandidateSchema>;

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
        contextText: z.string().max(1_000),
        evidenceQuote: z.string().max(500).nullable(),
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
        scopeText: z.string().max(1_000),
        explicitness: z.enum(["user_explicit", "user_confirmed", "inferred"]),
        confidence: z.number().min(0).max(1),
        evidenceQuote: z.string().max(500).nullable(),
      }),
    )
    .max(100),
  uncertainties: z
    .array(z.object({ topic: z.string(), reason: z.string(), recommendedQuestion: z.string().nullable() }))
    .max(50),
});
export type PreferenceCandidate = z.infer<typeof preferenceCandidateSchema>;

export const batchReviewSchema = z.object({
  decision: z.enum(["confirm_all", "confirm_selected", "reject_selected"]),
  targetIds: z.array(z.string().uuid()).max(300).default([]),
  reasonText: optionalText(2_000),
});

export const generationModeSchema = z.enum(["faithful", "balanced", "exploratory"]);
export const generationRequestInputSchema = z
  .object({
    mode: generationModeSchema.default("balanced"),
    purpose: text(2_000),
    world: optionalText(4_000),
    genre: optionalText(200),
    role: optionalText(2_000),
    tone: optionalText(1_000),
    freeInstruction: optionalText(4_000),
    selectedItemIds: z.array(z.string().uuid()).min(1).max(100),
    prohibitedItemIds: z.array(z.string().uuid()).max(100).default([]),
    redemption: z.enum(["required", "allowed", "not_required", "prohibited"]).default("not_required"),
    hiddenGoodness: z.enum(["required", "allowed", "not_required", "prohibited"]).default("not_required"),
  })
  .superRefine((input, context) => {
    if (input.selectedItemIds.some((id) => input.prohibitedItemIds.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["prohibitedItemIds"],
        message: "同じ項目を採用と禁止の両方には指定できません",
      });
    }
  });
export type GenerationRequestInput = z.infer<typeof generationRequestInputSchema>;

const generatedTraitSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(1_000),
  expressions: z.array(z.string().max(500)).max(20),
});
const generatedSectionSchema = z.object({
  summary: z.string().min(1).max(3_000),
  traits: z.array(generatedTraitSchema).min(1).max(30),
});
export const generatedCharacterCandidateSchema = z.object({
  schemaVersion: z.literal("1.0"),
  briefId: z.string().uuid(),
  identity: z.object({
    name: z.string().min(1).max(200),
    aliases: z.array(z.string().max(200)).max(20),
    oneLineConcept: z.string().min(1).max(500),
    origin: z.string().min(1).max(2_000),
    ageExpression: z.string().max(200).nullable(),
    pronouns: z.string().max(200).nullable(),
  }),
  appearance: generatedSectionSchema,
  personality: generatedSectionSchema,
  valuesAndMorality: z.object({
    orientation: valueOrientationSchema,
    values: z.array(generatedTraitSchema).min(1).max(30),
    moralRelationship: z.string().min(1).max(3_000),
    redemption: z.string().min(1).max(2_000),
    hiddenGoodness: z.string().min(1).max(2_000),
    consequences: z.string().min(1).max(2_000),
  }),
  motivations: generatedSectionSchema,
  abilitiesAndLimits: generatedSectionSchema,
  relationships: z
    .array(
      z.object({ targetRole: z.string(), dynamic: z.string(), characterBehavior: z.string(), development: z.string() }),
    )
    .max(30),
  speech: z.object({
    voice: z.string(),
    habits: z.array(z.string()).max(30),
    exampleLines: z.array(z.string()).max(5),
  }),
  narrativeRole: z.object({
    role: z.string(),
    function: z.string(),
    agency: z.string(),
    visibility: z.enum(["central", "supporting", "minor", "scene_limited"]),
  }),
  characterArc: z.object({
    start: z.string(),
    turningPoints: z.array(z.string()).max(20),
    end: z.string(),
    changeType: z.enum(["positive", "negative", "flat", "corruption", "no_redemption", "open", "other"]),
  }),
  briefCoverage: z
    .array(
      z.object({
        profileSnapshotItemId: z.string().uuid(),
        treatment: z.enum(["required", "include", "weak_include", "explore", "omit", "prohibit"]),
        status: z.enum(["satisfied", "partially_satisfied", "not_applicable", "violated"]),
        outputPointers: z.array(z.string().startsWith("/")).max(30),
        explanation: z.string().min(1).max(1_000),
      }),
    )
    .min(1)
    .max(200),
  uncertainties: z.array(z.string()).max(50),
});
export type GeneratedCharacterCandidate = z.infer<typeof generatedCharacterCandidateSchema>;

export type EntrySummary = {
  id: string;
  registrationType: RegistrationType;
  status: string;
  title: string;
  subtitle: string;
  activeRevisionNumber: number;
  updatedAt: string;
  reviewTargetId: string | null;
  job: {
    id: string;
    status: string;
    retryable: boolean;
    currentStep: string | null;
    progressCurrent: number;
    progressTotal: number;
    errorCode: string | null;
  } | null;
};
export type ProfileDimension = {
  id: string;
  stableKey: string;
  label: string;
  category: string;
  responseChannel: ResponseChannel | null;
  condition: Record<string, unknown>;
  positiveScore: number;
  negativeScore: number;
  confidence: number;
  evidenceCount: number;
  identityCount: number;
  classification: "stable" | "emerging" | "insufficient";
  flags: string[];
};
export type ProfileView = {
  projectionId: string;
  generation: number;
  profileSnapshotId: string;
  evidenceSetHash: string;
  dimensions: ProfileDimension[];
  patterns: Array<{ id: string; type: string; label: string; description: string; score: number; confidence: number }>;
  valueStances: Array<{ orientation: string; stance: string; count: number; labels: string[] }>;
  entryCount: number;
  updatedAt: string;
};
export type GraphProjection = {
  schemaVersion: "1.0";
  projectionId: string;
  profileGeneration: number;
  contentHash: string;
  detail: "summary" | "standard" | "expanded";
  nodes: Array<{ id: string; type: string; label: string; weight: number; attributes: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    directed: boolean;
    weight: number;
    confidence: number;
    evidenceCount: number;
    attributes: Record<string, unknown>;
  }>;
  truncated: boolean;
  truncationReason: string | null;
};
export type ApiError = { code: string; message: string; requestId: string; details?: unknown };
