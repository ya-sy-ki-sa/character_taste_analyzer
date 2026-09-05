import { z } from "zod";
import { darkResponseChannelSchema, responseChannelSchema } from "./taxonomy";

export const profileDimensionSchema = z
  .object({
    id: z.string(),
    stableKey: z.string(),
    label: z.string(),
    category: z.string(),
    responseChannel: z.union([responseChannelSchema, darkResponseChannelSchema, z.null()]),
    condition: z.record(z.string(), z.unknown()),
    positiveScore: z.number(),
    negativeScore: z.number(),
    confidence: z.number(),
    evidenceCount: z.number(),
    identityCount: z.number(),
    workCount: z.number(),
    classification: z.union([z.literal("stable"), z.literal("emerging"), z.literal("insufficient")]),
    flags: z.array(z.string()),
  })
  .meta({ id: "ProfileDimension" });
export type ProfileDimension = z.infer<typeof profileDimensionSchema>;

export const profileViewSchema = z
  .object({
    projectionId: z.string(),
    generation: z.number(),
    profileSnapshotId: z.string(),
    evidenceSetHash: z.string(),
    dimensions: z.array(profileDimensionSchema),
    valueStances: z.array(
      z.object({ orientation: z.string(), stance: z.string(), count: z.number(), labels: z.array(z.string()) }),
    ),
    entryCount: z.number(),
    updatedAt: z.string(),
  })
  .meta({ id: "ProfileView" });
export type ProfileView = z.infer<typeof profileViewSchema>;

export const projectionFreshnessSchema = z
  .object({
    status: z.union([z.literal("fresh"), z.literal("rebuilding"), z.literal("unavailable"), z.literal("failed")]),
    desiredGeneration: z.number(),
    builtGeneration: z.number(),
    errorCode: z.union([z.string(), z.null()]),
  })
  .meta({ id: "ProjectionFreshness" });
export type ProjectionFreshness = z.infer<typeof projectionFreshnessSchema>;

export const graphProjectionSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    projectionId: z.string(),
    profileGeneration: z.number(),
    contentHash: z.string(),
    detail: z.union([z.literal("summary"), z.literal("standard"), z.literal("expanded")]),
    nodes: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        weight: z.number(),
        attributes: z.record(z.string(), z.unknown()),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        type: z.string(),
        directed: z.boolean(),
        weight: z.number(),
        confidence: z.number(),
        evidenceCount: z.number(),
        attributes: z.record(z.string(), z.unknown()),
      }),
    ),
    truncated: z.boolean(),
    truncationReason: z.union([z.string(), z.null()]),
  })
  .meta({ id: "GraphProjection" });
export type GraphProjection = z.infer<typeof graphProjectionSchema>;

export const profileResponseSchema = z
  .object({ profile: profileViewSchema.nullable(), freshness: projectionFreshnessSchema })
  .meta({ id: "ProfileResponse" });
export const graphResponseSchema = z
  .object({ graph: graphProjectionSchema.nullable(), freshness: projectionFreshnessSchema })
  .meta({ id: "GraphResponse" });
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type GraphResponse = z.infer<typeof graphResponseSchema>;
