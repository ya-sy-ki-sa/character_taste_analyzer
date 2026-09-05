import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { apiErrorEnvelopeSchema } from "../shared/contracts/http";
import { moderationRejectionMessage } from "./features/entries/moderation";
import type { ModerationResult } from "./moderation/types";
import { dispatchOutboxEvent } from "./runtime/outbox";
import type { AppEnv } from "./types";

export function data<Schema extends z.ZodType>(value: unknown, schema: Schema): { data: z.output<Schema> } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("API_RESPONSE_INVALID");
  return { data: parsed.data };
}

export function createApiRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, context) => {
      if (result.success) return;
      return context.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "入力内容を確認してください",
            requestId: context.get("requestId"),
            details: result.error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
              message: issue.message,
            })),
          },
        },
        400,
      );
    },
  });
}

export function jsonResponse<Schema extends z.ZodType>(schema: Schema) {
  return { description: "Success", content: { "application/json": { schema: z.object({ data: schema }) } } };
}

const errorResponse = {
  description: "Request or processing error",
  content: { "application/json": { schema: apiErrorEnvelopeSchema } },
};
export const errorResponses = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  410: errorResponse,
  413: errorResponse,
  422: errorResponse,
  429: errorResponse,
  500: errorResponse,
  503: errorResponse,
} as const;

export function requireIdempotencyKey(value?: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Idempotency-KeyにはUUIDが必要です" });
  return parsed.data;
}

export function dispatchAfterCommit(context: Context<AppEnv>, eventId?: string) {
  if (eventId) context.executionCtx.waitUntil(dispatchOutboxEvent(context.env, eventId));
}

export async function requireAllowed(result: Promise<ModerationResult>) {
  const moderation = await result;
  if (!moderation.allowed) throw new HTTPException(422, { message: moderationRejectionMessage(moderation) });
}
