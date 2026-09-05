import { HTTPException } from "hono/http-exception";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/access";
export async function loadExportStatus(env: Env, ownerUserId: string, exportId: string) {
  const result = await first<Record<string, unknown>>(repository.selectAccountExports(env.DB, [exportId, ownerUserId]));
  if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
  return result;
}

export async function loadExportDownload(env: Env, ownerUserId: string, exportId: string) {
  const result = await first<{ status: string; object_key: string | null; expires_at: string | null }>(
    repository.selectAccountExports2(env.DB, [exportId, ownerUserId]),
  );
  if (!result) throw new HTTPException(404, { message: "エクスポートが見つかりません" });
  if (result.status !== "ready" || !result.object_key)
    throw new HTTPException(result.status === "expired" ? 410 : 409, {
      message: "エクスポートはダウンロードできません",
    });
  if (!result.expires_at || result.expires_at <= nowIso()) throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
  if (!env.EXPORTS) throw new HTTPException(503, { message: "エクスポート保存先が利用できません" });
  const object = await env.EXPORTS.get(result.object_key);
  if (!object) throw new HTTPException(410, { message: "EXPORT_EXPIRED" });
  return object;
}
