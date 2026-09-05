import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ModerationProviderError } from "./moderation/types";
import type { AppEnv } from "./types";

export const handleError: ErrorHandler<AppEnv> = (error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  if (error instanceof ModerationProviderError)
    return context.json(
      {
        error: {
          code: error.code,
          message: "入力内容の事前チェックを完了できませんでした。時間をおいて再度お試しください。",
          requestId,
        },
      },
      503,
    );
  if (error instanceof HTTPException) {
    const explicitCodes = new Set(["ORIGIN_REQUIRED", "ORIGIN_DENIED", "REGISTRATION_EXPIRED", "EXPORT_EXPIRED"]);
    const code = explicitCodes.has(error.message)
      ? error.message
      : error.status === 401
        ? "SESSION_REQUIRED"
        : error.status === 404
          ? "NOT_FOUND"
          : error.status === 409
            ? "CONFLICT"
            : error.status === 429
              ? "RATE_LIMITED"
              : "REQUEST_INVALID";
    const message =
      error.message === "ORIGIN_REQUIRED"
        ? "Originヘッダーが必要です"
        : error.message === "ORIGIN_DENIED"
          ? "許可されていない送信元です"
          : error.message === "REGISTRATION_EXPIRED"
            ? "有効化期限を過ぎています"
            : error.message === "EXPORT_EXPIRED"
              ? "エクスポートの有効期限を過ぎています"
              : error.message;
    return context.json({ error: { code, message, requestId } }, error.status);
  }
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました";
  const known: Record<string, [ContentfulStatusCode, string]> = {
    PROFILE_REQUIRED: [409, "好み分析を1件以上確定してから作成してください"],
    PROFILE_ITEM_NOT_FOUND: [404, "選択した好みの項目が見つかりません"],
    GENERATION_SELECTION_CONFLICT: [422, "同じ項目を採用と禁止の両方には指定できません"],
    UNDERSTANDING_REVIEW_NOT_FOUND: [404, "確認対象が見つかりません"],
    UNDERSTANDING_REVIEW_TARGET_NOT_FOUND: [404, "修正対象が見つかりません"],
    UNDERSTANDING_REVIEW_STATE_CHANGED: [409, "解析内容が更新されました。画面を再読み込みしてください"],
    UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE: [422, "削除する原典設定を特定できません"],
    IDEMPOTENCY_PAYLOAD_MISMATCH: [409, "同じIdempotency-Keyを異なる内容には使用できません"],
    ANALYSIS_JOB_NOT_FOUND: [404, "解析ジョブが見つかりません"],
    JOB_NOT_FAILED: [409, "失敗状態の解析だけ再実行できます"],
    JOB_NOT_RETRYABLE: [409, "この解析エラーは再実行できません"],
    JOB_SUPERSEDED: [409, "古い登録内容の解析は再実行できません"],
    JOB_RETRY_STATE_CHANGED: [409, "解析の状態が更新されました。画面を再読み込みしてください"],
    ENTRY_NOT_FOUND: [404, "キャラクターが見つかりません"],
    ENTRY_ANALYSIS_IN_PROGRESS: [409, "解析中のため、完了後に再分析してください"],
    ENTRY_REANALYSIS_UNAVAILABLE: [409, "この登録は再分析できません"],
    ENTRY_REGISTRATION_TYPE_IMMUTABLE: [422, "再分析では登録方法を変更できません"],
    ENTRY_REVISION_CONFLICT: [409, "登録内容が更新されました。画面を再読み込みしてください"],
    PROFILE_REBUILDING: [409, "プロフィールを再構築しています"],
    PREFERENCE_REVIEW_NOT_FOUND: [404, "確認対象が見つかりません"],
    PREFERENCE_REVIEW_TARGET_NOT_FOUND: [404, "削除する好みの候補が見つかりません"],
    PREFERENCE_REVIEW_STATE_CHANGED: [409, "好みの候補が更新されました。画面を再読み込みしてください"],
    IDENTITY_RESOLUTION_INVALID: [422, "選択した同一キャラクター候補を利用できません"],
    GENERATION_JOB_NOT_FOUND: [404, "生成ジョブが見つかりません"],
    GENERATION_NOT_FOUND: [404, "作成履歴が見つかりません"],
    GENERATION_DELETE_IN_PROGRESS: [409, "生成処理が完了してから削除してください"],
    GENERATION_DELETE_STATE_CHANGED: [409, "作成履歴の状態が更新されました。画面を再読み込みしてください"],
    EXPORT_STORAGE_UNAVAILABLE: [503, "エクスポート保存先を利用できません"],
  };
  const mapped = known[message];
  if (mapped) return context.json({ error: { code: message, message: mapped[1], requestId } }, mapped[0]);
  console.error(JSON.stringify({ requestId, code: message.slice(0, 100) }));
  return context.json({ error: { code: "INTERNAL_ERROR", message: "処理を完了できませんでした", requestId } }, 500);
};
