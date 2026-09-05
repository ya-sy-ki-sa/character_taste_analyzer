import { z } from "zod";
import { sessionUserSchema } from "../membership";

export const registeredUserSchema = sessionUserSchema
  .extend({ status: z.enum(["pending", "active"]) })
  .meta({ id: "RegisteredUser" });
export const registrationResultSchema = z
  .object({ user: registeredUserSchema, accessKey: z.string(), expiresAt: z.string().nullable() })
  .meta({ id: "RegistrationResult" });
export type RegistrationResult = z.infer<typeof registrationResultSchema>;
export const activationResultSchema = z.object({ user: registeredUserSchema }).meta({ id: "ActivationResult" });
export const exportCreationSchema = z
  .object({
    exportId: z.string(),
    jobId: z.string(),
    status: z.string(),
    replayed: z.boolean(),
    outboxEventId: z.string().optional(),
  })
  .meta({ id: "ExportCreation" });
export const exportStatusSchema = z
  .object({
    export: z.object({
      id: z.string(),
      status: z.enum(["queued", "running", "ready", "failed", "expired"]),
      schema_version: z.string(),
      byte_size: z.number().nullable(),
      error_code: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
      completed_at: z.string().nullable(),
      expires_at: z.string().nullable(),
    }),
  })
  .meta({ id: "ExportStatus" });
export type ExportCreation = z.infer<typeof exportCreationSchema>;
export type ExportStatus = z.infer<typeof exportStatusSchema>;

const exportedRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const exportedRowsSchema = z.array(exportedRowSchema);
const exportedDomainSchema = z.object({
  entries: exportedRowsSchema,
  works: exportedRowsSchema,
  identities: exportedRowsSchema,
  preferenceAssertions: exportedRowsSchema,
  profileDimensions: exportedRowsSchema,
  profileSnapshotItems: exportedRowsSchema,
  graphNodes: exportedRowsSchema,
  graphEdges: exportedRowsSchema,
  generationRequests: exportedRowsSchema,
  modelRuns: exportedRowsSchema,
  jobs: exportedRowsSchema,
  darkScopeAssessments: exportedRowsSchema.optional(),
  darkBaselineSnapshots: exportedRowsSchema.optional(),
  darkTransformationDeltas: exportedRowsSchema.optional(),
});
export const accountExportDocumentSchema = z
  .object({
    schemaVersion: z.literal("4.0"),
    exportedAt: z.string(),
    user: exportedRowSchema.nullable(),
    domains: z.object({ standard: exportedDomainSchema, dark: exportedDomainSchema }),
    entries: z.object({
      entries: exportedRowsSchema,
      revisions: exportedRowsSchema,
      works: exportedRowsSchema,
      identities: exportedRowsSchema,
      representations: exportedRowsSchema,
    }),
    sources: z.object({ sources: exportedRowsSchema, sets: exportedRowsSchema, setItems: exportedRowsSchema }),
    understanding: z.object({
      runs: exportedRowsSchema,
      snapshots: exportedRowsSchema,
      assertions: exportedRowsSchema,
      customizationDeltas: exportedRowsSchema,
      reviews: exportedRowsSchema,
      darkScopeAssessments: exportedRowsSchema,
      darkBaselineSnapshots: exportedRowsSchema,
      darkTransformationDeltas: exportedRowsSchema,
    }),
    quality: z.object({
      schemaVersion: z.literal("2.0"),
      candidates: exportedRowsSchema,
      feedback: exportedRowsSchema,
      refinements: exportedRowsSchema,
      similarityDocuments: exportedRowsSchema,
    }),
    preferenceAnalysis: z.object({
      runs: exportedRowsSchema,
      assertions: exportedRowsSchema,
      valueStances: exportedRowsSchema,
      evidence: exportedRowsSchema,
    }),
    profile: z.object({
      projections: exportedRowsSchema,
      dimensions: exportedRowsSchema,
      snapshots: exportedRowsSchema,
      snapshotItems: exportedRowsSchema,
    }),
    graph: z.object({ snapshots: exportedRowsSchema, nodes: exportedRowsSchema, edges: exportedRowsSchema }),
    generation: z.object({
      requests: exportedRowsSchema,
      preferences: exportedRowsSchema,
      briefs: exportedRowsSchema,
      characters: exportedRowsSchema,
      basisLinks: exportedRowsSchema,
      validations: exportedRowsSchema,
    }),
    operations: z.object({ modelRuns: exportedRowsSchema, jobs: exportedRowsSchema, jobAttempts: exportedRowsSchema }),
  })
  .meta({ id: "AccountExportDocument" });
export type AccountExportDocument = z.infer<typeof accountExportDocumentSchema>;
