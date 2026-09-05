import { z } from "zod";
import { darkStateModelSchema } from "./dark-understanding";
import { darkArchetypeHintSchema } from "./entries";
import { valueOrientationSchema } from "./taxonomy";
import { optionalText, text } from "./validation";

export const generationModeSchema = z.enum(["faithful", "balanced", "exploratory"]);

export const generationRequestInputSchema = z
  .object({
    profileSnapshotId: z.string().uuid(),
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

export const generatedTraitSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(1_000),
  expressions: z.array(z.string().max(500)).max(20),
});

export const generatedSectionSchema = z.object({
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

export const anyGeneratedCharacterCandidateSchema = z.union([
  generatedCharacterCandidateSchema,
  darkGeneratedCharacterCandidateSchema,
]);
