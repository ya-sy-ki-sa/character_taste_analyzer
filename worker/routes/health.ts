import { Hono } from "hono";
import { validateConfig } from "../config";
import { createEmbeddingProvider } from "../embedding/providers";
import { data } from "../http";
import type { AppEnv } from "../types";

export function createHealthRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/live", (context) => {
    return context.json(data({ status: "ok" }));
  });

  app.get("/ready", async (context) => {
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
      await context.env.DB.prepare("SELECT 1 AS ready").first();
    } catch {
      databaseReady = false;
    }
    const ready = errors.length === 0 && databaseReady && embeddingReady;
    return context.json(
      data({
        status: ready ? "ready" : "not_ready",
        environment: context.env.ENVIRONMENT,
        llmProvider: context.env.LLM_PROVIDER,
        embeddingProvider,
        embeddingModel,
        embeddingDimensions,
        checks: { database: databaseReady, configuration: errors.length === 0, embedding: embeddingReady },
        errors,
      }),
      ready ? 200 : 503,
    );
  });

  return app;
}
