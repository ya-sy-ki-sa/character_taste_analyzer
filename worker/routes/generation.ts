import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { generationRequestInputSchema } from "../../shared/contracts/generation";
import {
  feedbackReviewSchema,
  generationFeedbackSchema,
  generationSelectionSchema,
} from "../../shared/contracts/generation-feedback";
import {
  candidateSelectionResultSchema,
  feedbackCreationSchema,
  feedbackResponseSchema,
  feedbackReviewResultSchema,
  generationCreationSchema,
  generationListSchema,
} from "../../shared/contracts/generation-response";
import { requireSession } from "../auth";
import { moderateGenerationInput } from "../features/entries/moderation";
import { deleteGeneration } from "../features/generation/delete";
import {
  createGenerationFeedback,
  listGenerationFeedback,
  reviewGenerationFeedback,
  selectGenerationCandidate,
} from "../features/generation/feedback";
import { listGenerations } from "../features/generation/history";
import { createGenerationRequest } from "../features/generation/request";
import {
  createApiRouter,
  data,
  dispatchAfterCommit,
  errorResponses,
  jsonResponse,
  requireAllowed,
  requireIdempotencyKey,
} from "../http";
import { createModerationProvider } from "../moderation/providers";

export function createGenerationRoutes(domain: AnalysisDomain) {
  const app = createApiRouter();

  app.openapi(
    createRoute({
      method: "post",
      path: "/generation-requests",
      operationId: domain + "." + "generation.post..generation.requests",
      request: { body: { required: true, content: { "application/json": { schema: generationRequestInputSchema } } } },
      responses: { ...errorResponses, 202: jsonResponse(generationCreationSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      await requireAllowed(moderateGenerationInput(context.env, context.req.valid("json")));
      const result = await createGenerationRequest(
        context.env,
        session.userId,
        domain,
        context.req.valid("json"),
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      if (!result.jobId) throw new HTTPException(409, { message: "生成ジョブが見つかりません" });
      if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data(result, generationCreationSchema), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/generation-requests",
      operationId: domain + "." + "generation.get..generation.requests",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(generationListSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      return context.json(
        data({ generations: await listGenerations(context.env, session.userId, domain) }, generationListSchema),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/generation-requests/{id}",
      operationId: domain + "." + "generation.delete..generation.requests.id",
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { ...errorResponses, 204: { description: "No content" } },
    }),
    async (context) => {
      const session = requireSession(context);
      await deleteGeneration(context.env, session.userId, domain, context.req.param("id"));
      return context.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/generation-requests/{id}/selection",
      operationId: domain + "." + "generation.post..generation.requests.id.selection",
      request: {
        body: { required: true, content: { "application/json": { schema: generationSelectionSchema } } },
        params: z.object({ id: z.string().min(1) }),
      },
      responses: { ...errorResponses, 200: jsonResponse(candidateSelectionResultSchema) },
    }),
    async (context) => {
      const result = await selectGenerationCandidate(
        context.env,
        requireSession(context).userId,
        domain,
        context.req.param("id"),
        context.req.valid("json").candidateId,
      );
      return context.json(data(result, candidateSelectionResultSchema), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/generation-feedback",
      operationId: domain + "." + "generation.get..generation.feedback",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(feedbackResponseSchema) },
    }),
    async (context) =>
      context.json(
        data(await listGenerationFeedback(context.env, requireSession(context).userId, domain), feedbackResponseSchema),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/generation-feedback",
      operationId: domain + "." + "generation.post..generation.feedback",
      request: { body: { required: true, content: { "application/json": { schema: generationFeedbackSchema } } } },
      responses: { ...errorResponses, 200: jsonResponse(feedbackCreationSchema) },
    }),
    async (context) => {
      const input = context.req.valid("json");
      await requireAllowed(
        createModerationProvider(context.env).moderate([
          { field: "評価理由", text: input.reason },
          { field: "条件", text: input.scope },
        ]),
      );
      return context.json(
        data(
          await createGenerationFeedback(
            context.env,
            requireSession(context).userId,
            domain,
            input,
            requireIdempotencyKey(context.req.header("Idempotency-Key")),
          ),
          feedbackCreationSchema,
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/generation-feedback/{id}/review",
      operationId: domain + "." + "generation.post..generation.feedback.id.review",
      request: {
        body: { required: true, content: { "application/json": { schema: feedbackReviewSchema } } },
        params: z.object({ id: z.string().min(1) }),
      },
      responses: { ...errorResponses, 200: jsonResponse(feedbackReviewResultSchema) },
    }),
    async (context) => {
      const result = await reviewGenerationFeedback(
        context.env,
        requireSession(context).userId,
        domain,
        context.req.param("id"),
        context.req.valid("json").decision,
      );
      if (result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data(result, feedbackReviewResultSchema), 200);
    },
  );
  return app;
}
