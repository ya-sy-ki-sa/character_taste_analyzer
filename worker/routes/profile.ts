import { Hono } from "hono";
import { z } from "zod";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit } from "../http";
import { dispatchPendingProfileRebuild } from "../services/orchestration";
import { createDataStoreStrategy } from "../storage/strategy";
import type { AppEnv } from "../types";

export function createProfileRoutes(domain: AnalysisDomain) {
  const app = new Hono<AppEnv>();

  app.get("/profile", async (context) => {
    const session = requireSession(context);
    const strategy = createDataStoreStrategy(context.env);
    const algorithmRebuild = await strategy.ensureCurrentProfileAlgorithm(session.userId, domain);
    if (algorithmRebuild?.outboxEventId) dispatchAfterCommit(context, algorithmRebuild.outboxEventId);
    const [profile, freshness] = await Promise.all([
      strategy.loadCurrentProfile(session.userId, domain),
      strategy.loadProjectionFreshness(session.userId),
    ]);
    if (!profile && freshness.status === "rebuilding" && !algorithmRebuild?.outboxEventId)
      context.executionCtx.waitUntil(dispatchPendingProfileRebuild(context.env, session.userId));
    return context.json(data({ profile, freshness }));
  });

  app.get("/profile/snapshot-items", async (context) => {
    const session = requireSession(context);
    return context.json(
      data(await createDataStoreStrategy(context.env).loadProfileSnapshotItems(session.userId, domain)),
    );
  });

  app.get("/profile/graph", async (context) => {
    const session = requireSession(context);
    const detail = z.enum(["summary", "standard", "expanded"]).catch("standard").parse(context.req.query("detail"));
    const strategy = createDataStoreStrategy(context.env);
    // The dark graph endpoint has always returned only graph; preserve its response contract.
    if (domain === "dark")
      return context.json(data({ graph: await strategy.loadCurrentGraph(session.userId, domain, detail) }));
    const [graph, freshness] = await Promise.all([
      strategy.loadCurrentGraph(session.userId, domain, detail),
      strategy.loadProjectionFreshness(session.userId),
    ]);
    return context.json(data({ graph, freshness }));
  });

  return app;
}
