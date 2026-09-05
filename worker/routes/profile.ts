import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { snapshotResponseSchema } from "../../shared/contracts/generation-response";
import { graphResponseSchema, profileResponseSchema } from "../../shared/contracts/profile-response";
import { requireSession } from "../auth";
import { loadCurrentGraph } from "../features/profile/graph";
import { loadCurrentProfile, loadProjectionFreshness } from "../features/profile/projection";
import { loadProfileSnapshotItems } from "../features/profile/snapshot";
import { createApiRouter, data, errorResponses, jsonResponse } from "../http";
import { dispatchPendingProfileRebuild } from "../runtime/outbox";

export function createProfileRoutes(domain: AnalysisDomain) {
  const app = createApiRouter();

  app.openapi(
    createRoute({
      method: "get",
      path: "/profile",
      operationId: domain + "." + "profile.get..profile",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(profileResponseSchema) },
    }),
    async (context) => {
      const session = requireSession(context);

      const [profile, freshness] = await Promise.all([
        loadCurrentProfile(context.env, session.userId, domain),
        loadProjectionFreshness(context.env, session.userId),
      ]);
      if (!profile && freshness.status === "rebuilding")
        context.executionCtx.waitUntil(dispatchPendingProfileRebuild(context.env, session.userId));
      return context.json(data({ profile, freshness }, profileResponseSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/profile/snapshot-items",
      operationId: domain + "." + "profile.get..profile.snapshot.items",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(snapshotResponseSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      return context.json(
        data(await loadProfileSnapshotItems(context.env, session.userId, domain), snapshotResponseSchema),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/profile/graph",
      operationId: domain + "." + "profile.get..profile.graph",
      request: {
        query: z.object({
          detail: z
            .string()
            .optional()
            .describe("summary, standard, expanded; omitted or unrecognized values use standard"),
        }),
      },
      responses: { ...errorResponses, 200: jsonResponse(graphResponseSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const detail = z
        .enum(["summary", "standard", "expanded"])
        .catch("standard")
        .parse(context.req.valid("query").detail);

      const [graph, freshness] = await Promise.all([
        loadCurrentGraph(context.env, session.userId, domain, detail),
        loadProjectionFreshness(context.env, session.userId),
      ]);
      return context.json(data({ graph, freshness }, graphResponseSchema), 200);
    },
  );

  return app;
}
