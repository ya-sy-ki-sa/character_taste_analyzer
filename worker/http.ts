import { type Hook, zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ModerationResult } from "./moderation/types";
import { moderationRejectionMessage } from "./services/input-moderation";
import { dispatchOutboxEvent } from "./services/orchestration";
import type { AppEnv } from "./types";

export function data<T>(value: T) {
  return { data: value };
}

export function validateJson<Schema extends z.ZodType>(schema: Schema) {
  const onValidation: Hook<unknown, AppEnv, string, "json", Record<string, unknown>, Schema> = (result, context) => {
    if (result.success) return;
    return context.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください",
          requestId: context.get("requestId"),
          details: result.error.issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
        },
      },
      400,
    );
  };
  return zValidator<Schema, "json", AppEnv, string, typeof onValidation>("json", schema, onValidation);
}

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
