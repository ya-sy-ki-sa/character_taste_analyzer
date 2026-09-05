import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { accountDeletionSchema, accountExportRequestSchema } from "../../shared/schemas";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit, requireIdempotencyKey, validateJson } from "../http";
import { clearSessionCookie } from "../lib/cookies";
import { nowIso } from "../lib/crypto";
import { all, first } from "../lib/db";
import { createAccountExport } from "../services/exports";
import type { AppEnv } from "../types";

export function createAccountRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/exports", validateJson(accountExportRequestSchema), async (context) => {
    const session = requireSession(context);
    const result = await createAccountExport(
      context.env,
      session.userId,
      requireIdempotencyKey(context.req.header("Idempotency-Key")),
    );
    if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data(result), 202);
  });

  app.get("/exports/:exportId", async (context) => {
    const session = requireSession(context);
    const result = await first<Record<string, unknown>>(
      context.env.DB.prepare(
        `SELECT id,status,schema_version,byte_size,error_code,created_at,updated_at,completed_at,expires_at
       FROM account_exports WHERE id=? AND owner_user_id=?`,
      ).bind(context.req.param("exportId"), session.userId),
    );
    if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
    return context.json(data({ export: result }));
  });

  app.get("/exports/:exportId/download", async (context) => {
    const session = requireSession(context);
    const result = await first<{ status: string; object_key: string | null; expires_at: string | null }>(
      context.env.DB.prepare(
        `SELECT status,object_key,expires_at FROM account_exports WHERE id=? AND owner_user_id=?`,
      ).bind(context.req.param("exportId"), session.userId),
    );
    if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
    if (result.status !== "ready" || !result.object_key)
      throw new HTTPException(result.status === "expired" ? 410 : 409, {
        message: "エクスポートはダウンロードできません",
      });
    if (!result.expires_at || result.expires_at <= nowIso())
      throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
    if (!context.env.EXPORTS) throw new HTTPException(503, { message: "エクスポート保存先が利用できません" });
    const object = await context.env.EXPORTS.get(result.object_key);
    if (!object) throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set(
      "Content-Disposition",
      `attachment; filename="character-taste-export-${context.req.param("exportId")}.json"`,
    );
    return new Response(object.body, { headers });
  });

  app.delete("/", validateJson(accountDeletionSchema), async (context) => {
    const session = requireSession(context);
    if (context.req.valid("json").usernameConfirmation !== session.username)
      throw new HTTPException(422, { message: "確認用ユーザー名が一致しません" });
    if (context.env.EXPORTS) {
      const bucket = context.env.EXPORTS;
      const objects = await all<{ object_key: string | null }>(
        context.env.DB.prepare(`SELECT object_key FROM account_exports WHERE owner_user_id=?`).bind(session.userId),
      );
      await Promise.all(objects.flatMap((item) => (item.object_key ? [bucket.delete(item.object_key)] : [])));
    }
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(session.userId),
    ]);
    if (results.some((result) => !result.success))
      throw new HTTPException(500, { message: "アカウントを削除できませんでした" });
    context.header("Set-Cookie", clearSessionCookie(context.env.ENVIRONMENT));
    return context.body(null, 204);
  });

  return app;
}
