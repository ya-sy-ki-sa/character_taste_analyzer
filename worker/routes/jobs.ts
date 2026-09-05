import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { jobResponseSchema, jobRetryResultSchema } from "../../shared/contracts/jobs-response";
import { requireSession } from "../auth";
import { retryCharacterAnalysis } from "../features/analysis/retries";
import { retryGeneration } from "../features/generation/retry";
import { loadJob } from "../features/jobs/queries";
import {
  createApiRouter,
  data,
  dispatchAfterCommit,
  errorResponses,
  jsonResponse,
  requireIdempotencyKey,
} from "../http";

export function createJobsRoutes(domain: AnalysisDomain) {
  const app = createApiRouter();
  const notFoundMessage = domain === "dark" ? "ダークラボのジョブが見つかりません" : "ジョブが見つかりません";

  app.openapi(
    createRoute({
      method: "get",
      path: "/jobs/{id}",
      operationId: domain + "." + "jobs.get..jobs.id",
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { ...errorResponses, 200: jsonResponse(jobResponseSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const job = await loadJob(context.env, session.userId, domain, context.req.param("id"));
      if (!job) throw new HTTPException(404, { message: notFoundMessage });
      return context.json(data({ job }, jobResponseSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/jobs/{id}/retry",
      operationId: domain + "." + "jobs.post..jobs.id.retry",
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { ...errorResponses, 202: jsonResponse(jobRetryResultSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const retryId = requireIdempotencyKey(context.req.header("Idempotency-Key"));

      const job = await loadJob(context.env, session.userId, domain, context.req.param("id"));
      if (!job) throw new HTTPException(404, { message: notFoundMessage });
      const result =
        job.job_type === "generation"
          ? await retryGeneration(context.env, session.userId, context.req.param("id"), retryId)
          : job.job_type === "character_analysis"
            ? await retryCharacterAnalysis(context.env, session.userId, context.req.param("id"), retryId)
            : (() => {
                throw new HTTPException(409, { message: "このジョブ種別は再実行できません" });
              })();
      dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data({ ...result, status: "queued" }, jobRetryResultSchema), 202);
    },
  );

  return app;
}
