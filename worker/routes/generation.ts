import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import {
  feedbackReviewSchema,
  generationFeedbackSchema,
  generationSelectionSchema,
} from "../../shared/quality-schemas";
import { generationRequestInputSchema } from "../../shared/schemas";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit, requireAllowed, requireIdempotencyKey, validateJson } from "../http";
import { createModerationProvider } from "../moderation/providers";
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

  app.post("/generation-requests/:id/selection", validateJson(generationSelectionSchema), async (context) => {
    const result = await createDataStoreStrategy(context.env).selectGenerationCandidate(
      requireSession(context).userId,
      domain,
      context.req.param("id"),
      context.req.valid("json").candidateId,
    );
    return context.json(data(result));
  });
  app.get("/generation-feedback", async (context) =>
    context.json(
      data(await createDataStoreStrategy(context.env).listGenerationFeedback(requireSession(context).userId, domain)),
    ),
  );
  app.post("/generation-feedback", validateJson(generationFeedbackSchema), async (context) => {
    const input = context.req.valid("json");
    await requireAllowed(
      createModerationProvider(context.env).moderate([
        { field: "評価理由", text: input.reason },
        { field: "条件", text: input.scope },
      ]),
    );
    return context.json(
      data(
        await createDataStoreStrategy(context.env).createGenerationFeedback(
          requireSession(context).userId,
          domain,
          input,
          requireIdempotencyKey(context.req.header("Idempotency-Key")),
        ),
      ),
    );
  });
  app.post("/generation-feedback/:id/review", validateJson(feedbackReviewSchema), async (context) => {
    const result = await createDataStoreStrategy(context.env).reviewGenerationFeedback(
      requireSession(context).userId,
      domain,
      context.req.param("id"),
      context.req.valid("json").decision,
    );
    if (result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data(result));
  });
  return app;
}
