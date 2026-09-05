import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit, requireIdempotencyKey } from "../http";
import { createDataStoreStrategy } from "../storage/strategy";
import type { AppEnv } from "../types";

export function createJobsRoutes(domain: AnalysisDomain) {
  const app = new Hono<AppEnv>();
  const notFoundMessage = domain === "dark" ? "ダークラボのジョブが見つかりません" : "ジョブが見つかりません";

  app.get("/jobs/:id", async (context) => {
    const session = requireSession(context);
    const job = await createDataStoreStrategy(context.env).loadJob(session.userId, domain, context.req.param("id"));
    if (!job) throw new HTTPException(404, { message: notFoundMessage });
    return context.json(data({ job }));
  });

  app.post("/jobs/:id/retry", async (context) => {
    const session = requireSession(context);
    const retryId = requireIdempotencyKey(context.req.header("Idempotency-Key"));
    const strategy = createDataStoreStrategy(context.env);
    const job = await strategy.loadJob(session.userId, domain, context.req.param("id"));
    if (!job) throw new HTTPException(404, { message: notFoundMessage });
    const result =
      job.job_type === "generation"
        ? await strategy.retryGeneration(session.userId, context.req.param("id"), retryId)
        : job.job_type === "character_analysis"
          ? await strategy.retryCharacterAnalysis(session.userId, context.req.param("id"), retryId)
          : (() => {
              throw new HTTPException(409, { message: "このジョブ種別は再実行できません" });
            })();
    dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data({ ...result, status: "queued" }), 202);
  });

  return app;
}
