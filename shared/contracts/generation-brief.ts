import { z } from "zod";
import { generationModeSchema } from "./generation";
import { analysisDomainSchema } from "./taxonomy";

export const treatmentSchema = z
  .union([z.literal("required"), z.literal("include"), z.literal("explore"), z.literal("prohibit")])
  .meta({ id: "Treatment" });
export type Treatment = z.infer<typeof treatmentSchema>;

export const generationSelectionSchema = z
  .object({
    profileSnapshotItemId: z.string(),
    stableKey: z.string(),
    label: z.string(),
    treatment: treatmentSchema,
    weight: z.number(),
    condition: z.record(z.string(), z.unknown()),
    responseChannel: z.union([z.string(), z.null()]),
    reactionDescription: z.union([z.string(), z.null()]),
    polarity: z.union([z.object({ positive: z.number(), negative: z.number() }), z.null()]),
    valueStance: z.union([
      z.object({
        target: z.string(),
        targetType: z.string(),
        orientation: z.string(),
        stance: z.string(),
        scope: z.record(z.string(), z.unknown()),
      }),
      z.null(),
    ]),
    rationale: z.string(),
    overrideText: z.null(),
  })
  .meta({ id: "GenerationSelection" });
export type GenerationSelection = z.infer<typeof generationSelectionSchema>;

export const generationBriefSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    analysisDomain: analysisDomainSchema,
    briefId: z.string(),
    generationRequestId: z.string(),
    profileSnapshot: z.object({
      id: z.string(),
      generation: z.number(),
      contentHash: z.string(),
      ontologyVersion: z.string(),
      algorithmVersion: z.string(),
    }),
    mode: generationModeSchema,
    purpose: z.string(),
    creativeContext: z.object({
      world: z.union([z.string(), z.null()]),
      genre: z.union([z.string(), z.null()]),
      role: z.union([z.string(), z.null()]),
      tone: z.union([z.string(), z.null()]),
      targetDetail: z.literal("detailed"),
    }),
    preferenceSelections: z.array(generationSelectionSchema),
    valuePolicy: z.object({
      allowedOrientations: z.array(z.string()),
      requiredStances: z.array(
        z.object({ target: z.string(), stance: z.string(), scope: z.record(z.string(), z.unknown()) }),
      ),
      redemption: z.union([
        z.literal("required"),
        z.literal("allowed"),
        z.literal("not_required"),
        z.literal("prohibited"),
      ]),
      hiddenGoodness: z.union([
        z.literal("required"),
        z.literal("allowed"),
        z.literal("not_required"),
        z.literal("prohibited"),
      ]),
      moralJustification: z.literal("not_required"),
      punishmentOrDefeat: z.literal("not_required"),
    }),
    constraints: z.object({
      required: z.array(z.string()),
      prohibited: z.array(z.string()),
      contentBoundaries: z.array(z.string()),
      freeInstruction: z.union([z.string(), z.null()]),
    }),
    nonRequirements: z.array(z.string()),
    similarityPolicy: z.object({
      avoidNamedCharacters: z.array(z.string()),
      nameThreshold: z.number(),
      semanticThreshold: z.number(),
      combinationThreshold: z.number(),
    }),
    provenance: z.object({
      selectedItemIds: z.array(z.string()),
      userConstraintHash: z.string(),
      compiledAt: z.string(),
    }),
  })
  .meta({ id: "GenerationBrief" });
export type GenerationBrief = z.infer<typeof generationBriefSchema>;
