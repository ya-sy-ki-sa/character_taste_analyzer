import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { generationRequestInputSchema } from "../../shared/schemas";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit, requireAllowed, requireIdempotencyKey, validateJson } from "../http";
import { moderateGenerationInput } from "../services/input-moderation";
import { createDataStoreStrategy } from "../storage/strategy";
import type { AppEnv } from "../types";

export function createGenerationRoutes(domain: AnalysisDomain) {
  const app = new Hono<AppEnv>();

  app.post("/generation-requests", validateJson(generationRequestInputSchema), async (context) => {
    const session = requireSession(context);
    await requireAllowed(moderateGenerationInput(context.env, context.req.valid("json")));
    const result = await createDataStoreStrategy(context.env).createGenerationRequest(
      session.userId,
      domain,
      context.req.valid("json"),
      requireIdempotencyKey(context.req.header("Idempotency-Key")),
    );
    if (!result.jobId) throw new HTTPException(409, { message: "生成ジョブが見つかりません" });
    if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data(result), 202);
  });

  app.get(domain === "dark" ? "/generations" : "/generated-characters", async (context) => {
    const session = requireSession(context);
    return context.json(
      data({ generations: await createDataStoreStrategy(context.env).listGenerations(session.userId, domain) }),
    );
  });

  app.delete(domain === "dark" ? "/generations/:id" : "/generation-requests/:id", async (context) => {
    const session = requireSession(context);
    await createDataStoreStrategy(context.env).deleteGeneration(session.userId, domain, context.req.param("id"));
    return context.body(null, 204);
  });

  return app;
}
