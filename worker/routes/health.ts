import { createRoute } from "@hono/zod-openapi";
import { liveResponseSchema, readyResponseSchema } from "../../shared/contracts/health-response";
import { validateConfig } from "../config";
import { createEmbeddingProvider } from "../embedding/providers";
import { createApiRouter, data, errorResponses, jsonResponse } from "../http";
import * as repository from "./repositories/health";

export function createHealthRoutes() {
  const app = createApiRouter();

  app.openapi(
    createRoute({
      method: "get",
      path: "/live",
      operationId: "health.get..live",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(liveResponseSchema) },
    }),
    (context) => {
      return context.json(data({ status: "ok" }, liveResponseSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/ready",
      operationId: "health.get..ready",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(readyResponseSchema), 503: jsonResponse(readyResponseSchema) },
    }),
    async (context) => {
      const config = validateConfig(context.env);
      const errors = [...config.errors];
      let embeddingProvider = context.env.EMBEDDING_PROVIDER;
      let embeddingModel = context.env.EMBEDDING_MODEL;
      let embeddingDimensions = Number(context.env.EMBEDDING_DIMENSIONS);
      let embeddingReady = true;
      try {
        const embedding = createEmbeddingProvider(context.env);
        embeddingProvider = embedding.providerId;
        embeddingModel = embedding.model;
        embeddingDimensions = embedding.dimensions ?? embeddingDimensions;
      } catch {
        embeddingReady = false;
        if (!errors.includes("EMBEDDING_PROVIDER_CONFIGURATION_INVALID"))
          errors.push("EMBEDDING_PROVIDER_CONFIGURATION_INVALID");
      }
      let databaseReady = true;
      try {
        await repository.prepareQuery(context.env.DB).first();
      } catch {
        databaseReady = false;
      }
      const ready = errors.length === 0 && databaseReady && embeddingReady;
      return context.json(
        data(
          {
            status: ready ? "ready" : "not_ready",
            environment: context.env.ENVIRONMENT,
            llmProvider: context.env.LLM_PROVIDER,
            embeddingProvider,
            embeddingModel,
            embeddingDimensions: Number.isFinite(embeddingDimensions) ? embeddingDimensions : null,
            checks: { database: databaseReady, configuration: errors.length === 0, embedding: embeddingReady },
            errors,
          },
          readyResponseSchema,
        ),
        ready ? 200 : 503,
      );
    },
  );

  return app;
}
