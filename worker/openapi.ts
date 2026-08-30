import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import {
  accountDeletionSchema,
  accountExportRequestSchema,
  activationSchema,
  batchReviewSchema,
  entryReanalysisSchema,
  entrySubmissionSchema,
  generationRequestInputSchema,
  identityCandidateRequestSchema,
  understandingReviewRequestSchema,
  loginSchema,
  registrationSchema,
} from "../shared/schemas";

const successSchema = z.object({ data: z.unknown() });
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
const idParams = z.object({ id: z.string().uuid() });
const snapshotParams = z.object({ snapshotId: z.string().uuid() });
const runParams = z.object({ runId: z.string().uuid() });
const exportParams = z.object({ exportId: z.string().uuid() });
const commonResponses = {
  200: { description: "Success", content: { "application/json": { schema: successSchema } } },
  400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } },
  401: { description: "Authentication required", content: { "application/json": { schema: errorSchema } } },
  403: { description: "Origin or CSRF denied", content: { "application/json": { schema: errorSchema } } },
  404: { description: "Resource not found", content: { "application/json": { schema: errorSchema } } },
  409: { description: "State conflict", content: { "application/json": { schema: errorSchema } } },
  410: { description: "Resource expired", content: { "application/json": { schema: errorSchema } } },
  413: { description: "Body exceeds 64 KiB", content: { "application/json": { schema: errorSchema } } },
  422: { description: "Semantic validation failed", content: { "application/json": { schema: errorSchema } } },
  429: { description: "Rate or quota limited", content: { "application/json": { schema: errorSchema } } },
  500: { description: "Internal error", content: { "application/json": { schema: errorSchema } } },
  503: { description: "Dependency unavailable", content: { "application/json": { schema: errorSchema } } },
} as const;

type RouteDefinition = {
  method: "get" | "post" | "delete";
  path: string;
  summary: string;
  body?: z.ZodType;
  params?: z.ZodObject;
  status?: 200 | 201 | 202 | 204;
};

const definitions: RouteDefinition[] = [
  { method: "get", path: "/api/v1/health/live", summary: "Liveness" },
  { method: "get", path: "/api/v1/health/ready", summary: "Readiness" },
  { method: "get", path: "/api/v1/users", summary: "Public user search" },
  { method: "post", path: "/api/v1/users", summary: "Register user", body: registrationSchema, status: 201 },
  {
    method: "post",
    path: "/api/v1/users/{id}/activate",
    summary: "Activate registration",
    body: activationSchema,
    params: idParams,
  },
  { method: "post", path: "/api/v1/sessions", summary: "Create session", body: loginSchema },
  { method: "delete", path: "/api/v1/sessions", summary: "Delete session", status: 204 },
  { method: "get", path: "/api/v1/me", summary: "Current session" },
  {
    method: "post",
    path: "/api/v1/identity-candidates",
    summary: "Resolve owner-scoped identity candidates",
    body: identityCandidateRequestSchema,
  },
  { method: "get", path: "/api/v1/entries", summary: "List entries" },
  {
    method: "post",
    path: "/api/v1/entries",
    summary: "Create entry",
    body: entrySubmissionSchema,
    status: 202,
  },
  { method: "get", path: "/api/v1/entries/{id}", summary: "Entry review detail", params: idParams },
  {
    method: "post",
    path: "/api/v1/entries/{id}/reanalysis",
    summary: "Create entry revision and reanalysis",
    body: entryReanalysisSchema,
    params: idParams,
    status: 202,
  },
  { method: "delete", path: "/api/v1/entries/{id}", summary: "Archive entry", params: idParams, status: 204 },
  {
    method: "post",
    path: "/api/v1/understanding-snapshots/{snapshotId}/review",
    summary: "Review understanding snapshot",
    body: understandingReviewRequestSchema,
    params: snapshotParams,
    status: 202,
  },
  {
    method: "post",
    path: "/api/v1/preference-analysis-runs/{runId}/review",
    summary: "Review preference analysis run",
    body: batchReviewSchema,
    params: runParams,
    status: 202,
  },
  { method: "get", path: "/api/v1/profile", summary: "Profile and freshness" },
  { method: "get", path: "/api/v1/profile/snapshot-items", summary: "Generation snapshot items" },
  { method: "get", path: "/api/v1/profile/graph", summary: "Graph and freshness" },
  {
    method: "post",
    path: "/api/v1/generation-requests",
    summary: "Create generation request",
    body: generationRequestInputSchema,
    status: 202,
  },
  { method: "get", path: "/api/v1/generated-characters", summary: "List generated characters" },
  {
    method: "delete",
    path: "/api/v1/generation-requests/{id}",
    summary: "Delete completed generation history",
    params: idParams,
    status: 204,
  },
  { method: "get", path: "/api/v1/jobs/{id}", summary: "Job status", params: idParams },
  { method: "post", path: "/api/v1/jobs/{id}/retry", summary: "Retry by job type", params: idParams, status: 202 },
  {
    method: "post",
    path: "/api/v1/account/exports",
    summary: "Create asynchronous complete export",
    body: accountExportRequestSchema,
    status: 202,
  },
  {
    method: "get",
    path: "/api/v1/account/exports/{exportId}",
    summary: "Export status",
    params: exportParams,
  },
  {
    method: "get",
    path: "/api/v1/account/exports/{exportId}/download",
    summary: "Authenticated private export download",
    params: exportParams,
  },
  { method: "delete", path: "/api/v1/account", summary: "Delete account", body: accountDeletionSchema, status: 204 },
];

export const asBuiltRouteKeys = definitions.map(
  (definition) => `${definition.method.toUpperCase()} ${definition.path}`,
);

export function buildAsBuiltOpenApi() {
  const registry = new OpenAPIHono();
  for (const definition of definitions) {
    const status = definition.status ?? 200;
    const responses = {
      ...commonResponses,
      [status]:
        status === 204
          ? { description: "No content" }
          : { description: "Success", content: { "application/json": { schema: successSchema } } },
    };
    const route = createRoute({
      method: definition.method,
      path: definition.path,
      summary: definition.summary,
      request: {
        ...(definition.params ? { params: definition.params } : {}),
        ...(definition.body
          ? { body: { required: true, content: { "application/json": { schema: definition.body } } } }
          : {}),
      },
      responses,
    });
    registry.openapi(route, ((context: { json(value: unknown, status?: number): Response }) =>
      context.json(status === 204 ? null : { data: {} }, status)) as never);
  }
  return registry.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Character Taste Lab as-built API", version: "2.0.0" },
  });
}
