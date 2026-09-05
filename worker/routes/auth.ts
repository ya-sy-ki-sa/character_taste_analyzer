import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { activationSchema, loginSchema, registrationSchema } from "../../shared/contracts/account";
import { activationResultSchema, registrationResultSchema } from "../../shared/contracts/account-response";
import { meResponseSchema } from "../../shared/contracts/session-response";
import { requireSession, verifyTurnstile } from "../auth";
import { activateAccount, endSession, registerAccount, startSession } from "../features/account/authentication";
import { createApiRouter, data, errorResponses, jsonResponse, requireIdempotencyKey } from "../http";
import { clearSessionCookie, readSessionCookie, sessionCookie } from "../lib/cookies";

export function createAuthRoutes() {
  const app = createApiRouter();

  app.openapi(
    createRoute({
      method: "post",
      path: "/users",
      operationId: "auth.post..users",
      request: { body: { required: true, content: { "application/json": { schema: registrationSchema } } } },
      responses: {
        ...errorResponses,
        200: jsonResponse(registrationResultSchema),
        201: jsonResponse(registrationResultSchema),
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
      const key = requireIdempotencyKey(context.req.header("Idempotency-Key") || input.idempotencyKey);
      const { result, status } = await registerAccount(context.env, input, key);
      return context.json(data(result, registrationResultSchema), status);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/users/{id}/activate",
      operationId: "auth.post..users.id.activate",
      request: {
        body: { required: true, content: { "application/json": { schema: activationSchema } } },
        params: z.object({ id: z.string().min(1) }),
      },
      responses: { ...errorResponses, 200: jsonResponse(activationResultSchema) },
    }),
    async (context) => {
      return context.json(
        data(
          await activateAccount(context.env, context.req.param("id"), context.req.valid("json")),
          activationResultSchema,
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/sessions",
      operationId: "auth.post..sessions",
      request: { body: { required: true, content: { "application/json": { schema: loginSchema } } } },
      responses: { ...errorResponses, 200: jsonResponse(meResponseSchema) },
    }),
    async (context) => {
      const input = context.req.valid("json");
      await verifyTurnstile(context.env, input.turnstileToken, context.req.header("CF-Connecting-IP"));
      const { result, token, maxAge } = await startSession(context.env, input);
      context.header("Set-Cookie", sessionCookie(token, maxAge, context.env.ENVIRONMENT));
      return context.json(data(result, meResponseSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/sessions",
      operationId: "auth.delete..sessions",
      request: {},
      responses: { ...errorResponses, 204: { description: "No content" } },
    }),
    async (context) => {
      const token = readSessionCookie(context.req.header("Cookie"), context.env.ENVIRONMENT);
      await endSession(context.env, token);
      context.header("Set-Cookie", clearSessionCookie(context.env.ENVIRONMENT));
      return context.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/me",
      operationId: "auth.get..me",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(meResponseSchema) },
    }),
    (context) => {
      const session = requireSession(context);
      return context.json(
        data(
          {
            user: { id: session.userId, username: session.username, membershipTier: session.membershipTier },
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
          },
          meResponseSchema,
        ),
        200,
      );
    },
  );

  return app;
}
