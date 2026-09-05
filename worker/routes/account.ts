import { createRoute } from "@hono/zod-openapi";
import type { TypedResponse } from "hono";
import { z } from "zod";
import { accountDeletionSchema, accountExportRequestSchema } from "../../shared/contracts/account";
import type { AccountExportDocument } from "../../shared/contracts/account-response";
import {
  accountExportDocumentSchema,
  exportCreationSchema,
  exportStatusSchema,
} from "../../shared/contracts/account-response";
import { requireSession } from "../auth";
import { deleteAccount } from "../features/account/deletion";
import { loadExportDownload, loadExportStatus } from "../features/account/export-access";
import { createAccountExport } from "../features/account/exports";
import {
  createApiRouter,
  data,
  dispatchAfterCommit,
  errorResponses,
  jsonResponse,
  requireIdempotencyKey,
} from "../http";
import { clearSessionCookie } from "../lib/cookies";

export function createAccountRoutes() {
  const app = createApiRouter();

  app.openapi(
    createRoute({
      method: "post",
      path: "/exports",
      operationId: "account.post..exports",
      request: { body: { required: true, content: { "application/json": { schema: accountExportRequestSchema } } } },
      responses: { ...errorResponses, 202: jsonResponse(exportCreationSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const result = await createAccountExport(
        context.env,
        session.userId,
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data(result, exportCreationSchema), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/exports/{exportId}",
      operationId: "account.get..exports.exportId",
      request: { params: z.object({ exportId: z.string().min(1) }) },
      responses: { ...errorResponses, 200: jsonResponse(exportStatusSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const result = await loadExportStatus(context.env, session.userId, context.req.param("exportId"));
      return context.json(data({ export: result }, exportStatusSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/exports/{exportId}/download",
      operationId: "account.get..exports.exportId.download",
      request: { params: z.object({ exportId: z.string().min(1) }) },
      responses: {
        ...errorResponses,
        200: {
          description: "Account export JSON download",
          content: { "application/json": { schema: accountExportDocumentSchema } },
        },
      },
    }),
    async (context) => {
      const session = requireSession(context);
      const object = await loadExportDownload(context.env, session.userId, context.req.param("exportId"));
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set(
        "Content-Disposition",
        `attachment; filename="character-taste-export-${context.req.param("exportId")}.json"`,
      );
      // The producer validates this document before storing it; retain streaming delivery.
      return new Response(object.body, { headers }) as Response & TypedResponse<AccountExportDocument, 200, "json">;
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/",
      operationId: "account.delete..",
      request: { body: { required: true, content: { "application/json": { schema: accountDeletionSchema } } } },
      responses: { ...errorResponses, 204: { description: "No content" } },
    }),
    async (context) => {
      const session = requireSession(context);
      await deleteAccount(
        context.env,
        session.userId,
        session.username,
        context.req.valid("json").usernameConfirmation,
      );
      context.header("Set-Cookie", clearSessionCookie(context.env.ENVIRONMENT));
      return context.body(null, 204);
    },
  );

  return app;
}
