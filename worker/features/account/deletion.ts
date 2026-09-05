import { HTTPException } from "hono/http-exception";
import { all } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/access";
export async function deleteAccount(env: Env, ownerUserId: string, username: string, usernameConfirmation: string) {
  if (usernameConfirmation !== username) throw new HTTPException(422, { message: "確認用ユーザー名が一致しません" });
  if (env.EXPORTS) {
    const bucket = env.EXPORTS;
    const objects = await all<{ object_key: string | null }>(repository.selectAccountExports3(env.DB, [ownerUserId]));
    await Promise.all(objects.flatMap((item) => (item.object_key ? [bucket.delete(item.object_key)] : [])));
  }
  const results = await env.DB.batch([repository.deleteUsers(env.DB, [ownerUserId])]);
  if (results.some((result) => !result.success))
    throw new HTTPException(500, { message: "アカウントを削除できませんでした" });
}
