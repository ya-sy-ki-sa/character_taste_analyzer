import { z } from "zod";
import { analysisDomainValues } from "./analysis-domain";
import { type DarkResponseChannel, darkResponseChannelValues } from "./dark-response-channels";
import { type ResponseChannel, responseChannelValues } from "./response-channels";

export type { AnalysisDomain } from "./analysis-domain";
export type { DarkResponseChannel } from "./dark-response-channels";
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
  username: usernameSchema,
  accessKey: z.string().uuid(),
  turnstileToken: z.string().optional(),
});
export const accountDeletionSchema = z.object({ usernameConfirmation: usernameSchema });

export const registrationTypeSchema = z.enum(["existing", "customized_existing", "original"]);
export type RegistrationType = z.infer<typeof registrationTypeSchema>;
export const analysisDomainSchema = z.enum(analysisDomainValues);
export const responseChannelSchema = z.enum(responseChannelValues);
export const darkResponseChannelSchema = z.enum(darkResponseChannelValues);
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

const commonEntryFields = {
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

const darkCommonEntryFields = {
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

export function isDarkEntryDraft(draft: AnyEntryDraft): draft is DarkEntryDraft {
  return "darkContext" in draft;
}

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

export function entryPreferenceContext(draft: AnyEntryDraft): string | undefined {
  return draft.preferenceContext;
}

export function entryScopeText(draft: AnyEntryDraft): string {
  return entryPreferenceContext(draft) ?? "キャラクター全体";
}

export function entryReferenceMaterial(draft: AnyEntryDraft): string | undefined {
  return draft.referenceMaterial;
}

export function entryBaseCharacterName(draft: AnyEntryDraft): string {
  if (draft.registrationType !== "customized_existing") return draft.characterName;
  return draft.baseCharacterName;
}

export type EntryInputSource = {
  pointer: string;
  label: string;
  text: string;
};

export function canonicalEntryInputPointer(pointer: string | null | undefined): string | null {
  if (!pointer) return null;
  let canonical = pointer.trim();
  if (!canonical.startsWith("/")) canonical = `/${canonical}`;
  for (const wrapper of ["/登録情報", "/input", "/entry"]) {
    if (canonical.startsWith(`${wrapper}/`)) {
      canonical = canonical.slice(wrapper.length);
      break;
    }
  }
  return canonical;
}

/**
 * Character/preference analysis may cite only these user-input fragments.
 * Keep this list shared by entry creation, local migration and prompt construction
 * so that a JSON Pointer emitted by the model always has a persisted source.
 */
export function entryInputSources(draft: AnyEntryDraft): EntryInputSource[] {
  const referenceMaterial = entryReferenceMaterial(draft);
  const preferenceContext = entryPreferenceContext(draft);
  return [
    draft.registrationType === "original" ? null : { pointer: "/workTitle", label: "作品名", text: draft.workTitle },
    draft.registrationType === "customized_existing"
      ? { pointer: "/baseCharacterName", label: "既成キャラクター名", text: entryBaseCharacterName(draft) }
      : null,
    { pointer: "/characterName", label: "キャラクター名", text: draft.characterName },
    draft.registrationType === "original" || !draft.mediaType
      ? null
      : { pointer: "/mediaType", label: "媒体種別", text: draft.mediaType },
    draft.registrationType === "customized_existing"
      ? { pointer: "/representationType", label: "改変種別", text: draft.representationType }
      : null,
    draft.registrationType === "customized_existing"
      ? {
          pointer: "/customizationDescription",
          label: "改変内容",
          text: draft.customizationDescription,
        }
      : null,
    draft.registrationType === "original"
      ? { pointer: "/characterBasicInfo", label: "キャラクター基本情報", text: draft.characterBasicInfo }
      : null,
    preferenceContext ? { pointer: "/preferenceContext", label: "対象範囲・場面", text: preferenceContext } : null,
    referenceMaterial ? { pointer: "/referenceMaterial", label: "追加の参考情報", text: referenceMaterial } : null,
    draft.userCharacterView
      ? { pointer: "/userCharacterView", label: "ユーザーのキャラクター観", text: draft.userCharacterView }
      : null,
    isDarkEntryDraft(draft)
      ? {
          pointer: "/darkContext/focusDescription",
          label: "注目するダーク状態",
          text: draft.darkContext.focusDescription,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.beforeState
      ? { pointer: "/darkContext/beforeState", label: "変化前の状態", text: draft.darkContext.beforeState }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.transitionTrigger
      ? { pointer: "/darkContext/transitionTrigger", label: "闇化の契機", text: draft.darkContext.transitionTrigger }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.controllerOrInfluence
      ? {
          pointer: "/darkContext/controllerOrInfluence",
          label: "支配者・影響源",
          text: draft.darkContext.controllerOrInfluence,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.controlMechanism
      ? {
          pointer: "/darkContext/controlMechanism",
          label: "支配・変化の機構",
          text: draft.darkContext.controlMechanism,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.awarenessAndResistance
      ? {
          pointer: "/darkContext/awarenessAndResistance",
          label: "認識・抵抗",
          text: draft.darkContext.awarenessAndResistance,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.relationshipChange
      ? { pointer: "/darkContext/relationshipChange", label: "関係変化", text: draft.darkContext.relationshipChange }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.responsibilityNote
      ? {
          pointer: "/darkContext/responsibilityNote",
          label: "責任の捉え方",
          text: draft.darkContext.responsibilityNote,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.desiredOutcome
      ? { pointer: "/darkContext/desiredOutcome", label: "望む結末", text: draft.darkContext.desiredOutcome }
      : null,
    draft.preference.likedReasons
      ? { pointer: "/preference/likedReasons", label: "好きな理由", text: draft.preference.likedReasons }
      : null,
    draft.preference.dislikedReasons
      ? { pointer: "/preference/dislikedReasons", label: "苦手な理由", text: draft.preference.dislikedReasons }
      : null,
    {
      pointer: "/preference/responseChannels",
      label: "選択した惹かれ方",
      text: JSON.stringify(draft.preference.responseChannels),
    },
    draft.preference.valueStanceNote
      ? { pointer: "/preference/valueStanceNote", label: "価値スタンス", text: draft.preference.valueStanceNote }
      : null,
  ].filter((item): item is EntryInputSource => item !== null);
}

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
        evidence: z.array(evidenceReferenceSchema).max(3),
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

export const darkScopeAssessmentSchema = z.object({
  verdict: z.enum(["in_scope", "borderline", "out_of_scope"]),
  qualifyingArchetypes: z.array(darkArchetypeHintSchema).max(10),
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  scope: z.enum(["whole_character", "phase", "form", "scene", "relationship", "unknown"]),
  rationale: z.string().min(1).max(3_000),
  limitations: z.array(z.string().max(1_000)).max(20),
  evidence: z.array(evidenceReferenceSchema).max(6),
  recommendedQuestions: z.array(z.string().max(500)).max(10),
});
export type DarkScopeAssessment = z.infer<typeof darkScopeAssessmentSchema>;
export const darkScopeReviewRequestSchema = z.object({
  decision: z.enum(["continue", "cancel"]),
  reasonText: optionalText(2_000),
});
export type DarkScopeReviewRequest = z.infer<typeof darkScopeReviewRequestSchema>;

export const darkStateModelSchema = z.object({
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  consent: z.enum(["chosen", "coerced", "unaware", "ambivalent", "unknown"]),
  awareness: z.enum(["aware", "partially_aware", "unaware", "unknown"]),
  resistance: z.enum(["active", "intermittent", "internal_only", "none", "unknown"]),
  identityContinuity: z.enum(["intact", "fragmented", "suppressed", "replaced", "unknown"]),
  responsibility: z.enum(["high", "reduced", "contested", "unknown"]),
  reversibility: z.enum(["reversible", "conditional", "irreversible", "unknown"]),
  controllerOrInfluence: z.string().max(1_000).nullable(),
  mechanism: z.string().max(1_000).nullable(),
  before: z.string().max(2_000).nullable(),
  onset: z.string().max(2_000).nullable(),
  activeState: z.string().min(1).max(3_000),
  recoveryOrAfter: z.string().max(2_000).nullable(),
});
export type DarkStateModel = z.infer<typeof darkStateModelSchema>;

export const darkBaselineUnderstandingSchema = z.object({
  identity: z.string().min(1).max(2_000),
  narrativeRole: z.array(z.string().max(500)).max(20),
  agency: z.array(z.string().max(500)).max(20),
  moralCommitments: z.array(z.string().max(500)).max(30),
  protectedPeopleOrValues: z.array(z.string().max(500)).max(30),
  relationships: z.array(z.string().max(500)).max(50),
  abilitiesAndDuties: z.array(z.string().max(500)).max(50),
  selfConcept: z.array(z.string().max(500)).max(30),
  priorVulnerabilities: z.array(z.string().max(500)).max(30),
  uncertainties: z.array(z.object({ topic: z.string().max(500), reason: z.string().max(2_000) })).max(50),
  evidence: z.array(evidenceReferenceSchema).max(30),
});
export type DarkBaselineUnderstanding = z.infer<typeof darkBaselineUnderstandingSchema>;

export const darkTransformationOperationSchema = z.enum([
  "retained",
  "amplified",
  "suppressed",
  "inverted",
  "removed",
  "introduced",
  "ambiguous",
]);

export const darkTransformationDeltaSchema = z.object({
  operation: darkTransformationOperationSchema,
  aspect: z.string().min(1).max(500),
  beforeValue: z.string().max(2_000).nullable(),
  afterValue: z.string().max(2_000).nullable(),
  cause: z.string().max(1_000).nullable(),
  agencyOrigin: z.enum(["self_authored", "externally_imposed", "mixed", "unclear"]),
  controller: z.string().max(1_000).nullable(),
  awareness: z.enum(["aware", "partially_aware", "unaware", "unknown"]),
  resistance: z.enum(["active", "intermittent", "internal_only", "none", "unknown"]),
  identityContinuity: z.enum(["intact", "fragmented", "suppressed", "replaced", "unknown"]),
  responsibility: z.enum(["high", "reduced", "contested", "unknown"]),
  reversibility: z.enum(["reversible", "conditional", "irreversible", "unknown"]),
  phase: z.enum(["before", "onset", "active", "recovery", "after", "unknown"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceReferenceSchema).max(3),
});
export type DarkTransformationDelta = z.infer<typeof darkTransformationDeltaSchema>;

export const darkUnderstandingCandidateSchema = understandingCandidateSchema.extend({
  darkState: darkStateModelSchema,
  transformationDeltas: z.array(darkTransformationDeltaSchema).max(100),
  auditNotes: z.array(z.string().max(1_000)).max(50),
});
export type DarkUnderstandingCandidate = z.infer<typeof darkUnderstandingCandidateSchema>;

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
        recommendedQuestion: z.string().max(1_000).nullable(),
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

export const batchReviewSchema = z.object({
  decision: z.enum(["confirm_all", "confirm_selected", "reject_selected"]),
  targetIds: z.array(z.string().uuid()).max(300).default([]),
  reasonText: optionalText(2_000),
});

const preferenceReviewAssertionFields = {
  rawLabel: text(200),
  attributeStableKey: z
    .string()
    .regex(/^[a-z0-9_.-]+$/u)
    .max(150)
    .nullable()
    .default(null),
  polarity: z.enum(["positive", "negative", "mixed"]),
  responseChannel: z.union([responseChannelSchema, darkResponseChannelSchema]),
  strength: z.number().min(0).max(1),
};
const preferenceReviewStanceFields = {
  targetRef: text(500),
  stance: valueStanceSchema,
  orientation: valueOrientationSchema,
};
export const preferenceReviewMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_preference"), ...preferenceReviewAssertionFields }),
  z.object({ action: z.literal("update_preference"), targetId: z.string().uuid(), ...preferenceReviewAssertionFields }),
  z.object({ action: z.literal("add_value_stance"), ...preferenceReviewStanceFields }),
  z.object({ action: z.literal("update_value_stance"), targetId: z.string().uuid(), ...preferenceReviewStanceFields }),
]);
export type PreferenceReviewMutation = z.infer<typeof preferenceReviewMutationSchema>;
export const preferenceReviewRequestSchema = z.union([batchReviewSchema, preferenceReviewMutationSchema]);

const reviewDeltaFields = {
  operation: z.enum(["inherit", "add", "modify", "remove", "invert", "narrow_scope", "emphasize", "unspecified"]),
  beforeValue: z.string().trim().min(1).max(2_000).nullable(),
  afterValue: z.string().trim().min(1).max(2_000).nullable(),
  reasonText: z.string().trim().min(1).max(2_000).nullable().default(null),
};

export const understandingReviewMutationSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("add_assertion"),
      rawLabel: text(200),
      valueText: text(2_000),
      attributeStableKey: z
        .string()
        .regex(/^[a-z0-9_.-]+$/u)
        .max(150)
        .nullable()
        .default(null),
    }),
    z.object({
      action: z.literal("update_assertion"),
      targetId: z.string().uuid(),
      rawLabel: text(200),
      valueText: text(2_000),
      attributeStableKey: z
        .string()
        .regex(/^[a-z0-9_.-]+$/u)
        .max(150)
        .nullable()
        .default(null),
    }),
    z.object({ action: z.literal("delete_assertion"), targetId: z.string().uuid() }),
    z.object({ action: z.literal("add_delta"), ...reviewDeltaFields }),
    z.object({ action: z.literal("update_delta"), targetId: z.string().uuid(), ...reviewDeltaFields }),
    z.object({ action: z.literal("delete_delta"), targetId: z.string().uuid() }),
  ])
  .superRefine((input, context) => {
    if (input.action !== "add_delta" && input.action !== "update_delta") return;
    if (input.operation === "add" && (input.beforeValue !== null || input.afterValue === null))
      context.addIssue({ code: "custom", message: "追加には変更後の設定だけを入力してください" });
    if (input.operation === "remove" && (input.beforeValue === null || input.afterValue !== null))
      context.addIssue({ code: "custom", message: "削除には原典の設定だけを入力してください" });
    if (["modify", "invert"].includes(input.operation) && (input.beforeValue === null || input.afterValue === null))
      context.addIssue({ code: "custom", message: "変更・反転には原典と変更後の設定が必要です" });
    if (input.beforeValue === null && input.afterValue === null)
      context.addIssue({ code: "custom", message: "原典または変更後の設定を入力してください" });
  });
export type UnderstandingReviewMutation = z.infer<typeof understandingReviewMutationSchema>;
export const understandingReviewRequestSchema = z.union([batchReviewSchema, understandingReviewMutationSchema]);

export const generationModeSchema = z.enum(["faithful", "balanced", "exploratory"]);
export const accountExportRequestSchema = z.object({}).strict();
export const generationRequestInputSchema = z
  .object({
    profileSnapshotId: z.string().uuid().optional(),
    mode: generationModeSchema.default("balanced"),
    purpose: text(2_000),
    world: optionalText(4_000),
    genre: optionalText(200),
    role: optionalText(2_000),
    tone: optionalText(1_000),
    freeInstruction: optionalText(4_000),
    selectedItemIds: z.array(z.string().uuid()).min(1).max(100),
    prohibitedItemIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict()
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

export const generationValidationReportSchema = z.object({
  passed: z.boolean(),
  checks: z
    .array(
      z.object({
        constraintId: z.string().min(1).max(200),
        status: z.enum(["satisfied", "violated", "uncertain"]),
        outputPointers: z.array(z.string().startsWith("/").max(500)).max(20),
        explanation: z.string().min(1).max(1_000),
      }),
    )
    .max(250),
  violations: z.array(z.string().min(1).max(1_000)).max(100),
});
export type GenerationValidationReport = z.infer<typeof generationValidationReportSchema>;

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
      z.object({
        targetRole: z.string().min(1).max(300),
        dynamic: z.string().min(1).max(2_000),
        characterBehavior: z.string().min(1).max(2_000),
        development: z.string().min(1).max(2_000),
      }),
    )
    .max(30),
  speech: z.object({
    voice: z.string().min(1).max(2_000),
    habits: z.array(z.string().max(500)).max(30),
    exampleLines: z.array(z.string().max(500)).max(5),
  }),
  narrativeRole: z.object({
    role: z.string().min(1).max(500),
    function: z.string().min(1).max(2_000),
    agency: z.string().min(1).max(2_000),
    visibility: z.enum(["central", "supporting", "minor", "scene_limited"]),
  }),
  characterArc: z.object({
    start: z.string().min(1).max(2_000),
    turningPoints: z.array(z.string().max(1_000)).max(20),
    end: z.string().min(1).max(2_000),
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
  uncertainties: z.array(z.string().max(1_000)).max(50),
});
export type GeneratedCharacterCandidate = z.infer<typeof generatedCharacterCandidateSchema>;

export const darkGeneratedCharacterCandidateSchema = generatedCharacterCandidateSchema.extend({
  schemaVersion: z.literal("dark-1.0"),
  darkCore: z.object({
    archetypes: z.array(darkArchetypeHintSchema).min(1).max(10),
    narrativeFunction: z.string().min(1).max(2_000),
    agency: darkStateModelSchema,
  }),
  baselineAndTransition: z.object({
    baseline: z.string().max(3_000).nullable(),
    trigger: z.string().max(3_000).nullable(),
    retained: z.array(z.string().max(500)).max(30),
    changed: z.array(z.string().max(500)).max(30),
  }),
  darkMorality: z.object({
    logic: z.string().min(1).max(3_000),
    transgressions: z.array(z.string().max(1_000)).max(30),
    responsibility: z.string().min(1).max(2_000),
  }),
  darkRelationships: z
    .array(
      z.object({
        targetRole: z.string().min(1).max(300),
        dynamic: z.string().min(1).max(2_000),
        beforeAndAfter: z.string().max(2_000).nullable(),
      }),
    )
    .max(30),
  darkArc: z.object({
    currentState: z.string().min(1).max(3_000),
    possibleOutcome: z.string().min(1).max(3_000),
    redemptionPolicy: z.string().min(1).max(2_000),
  }),
  darkExpression: generatedSectionSchema,
});
export type DarkGeneratedCharacterCandidate = z.infer<typeof darkGeneratedCharacterCandidateSchema>;
export type AnyGeneratedCharacterCandidate = GeneratedCharacterCandidate | DarkGeneratedCharacterCandidate;

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
    errorDetail: string | null;
  } | null;
};
export type ProfileDimension = {
  id: string;
  stableKey: string;
  label: string;
  category: string;
  responseChannel: ResponseChannel | DarkResponseChannel | null;
  condition: Record<string, unknown>;
  positiveScore: number;
  negativeScore: number;
  confidence: number;
  evidenceCount: number;
  identityCount: number;
  workCount: number;
  classification: "stable" | "emerging" | "insufficient";
  flags: string[];
};
export type ProfileView = {
  projectionId: string;
  generation: number;
  profileSnapshotId: string;
  evidenceSetHash: string;
  dimensions: ProfileDimension[];
  valueStances: Array<{ orientation: string; stance: string; count: number; labels: string[] }>;
  entryCount: number;
  updatedAt: string;
};
export type ProjectionFreshness = {
  status: "fresh" | "rebuilding" | "unavailable" | "failed";
  desiredGeneration: number;
  builtGeneration: number;
  errorCode: string | null;
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
export type AccountExportStatus = {
  id: string;
  jobId: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  schemaVersion: "3.0";
  byteSize: number | null;
  contentHash: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};
export type ApiError = { code: string; message: string; requestId: string; details?: unknown };
