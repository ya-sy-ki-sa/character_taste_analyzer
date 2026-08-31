import { HTTPException } from "hono/http-exception";
import { deriveUuid, nowIso } from "../lib/crypto";
import { first } from "../lib/db";
import type { Env } from "../types";
import { nextQuotaSlot, type QuotaCapability, quotaLimit } from "./quota-policy";

export type { QuotaCapability } from "./quota-policy";

export type QuotaReservation = {
  id: string;
  statements: D1PreparedStatement[];
};

/**
 * Builds statements that are committed in the same D1 batch as the domain
 * object, job and outbox event. Callers must first perform their idempotency
 * replay lookup so a replay never reaches this function.
 */
export async function prepareQuotaReservation(
  env: Env,
  ownerUserId: string,
  capability: QuotaCapability,
  idempotencyKey: string,
  requestHash: string,
): Promise<QuotaReservation> {
  const usageDate = nowIso().slice(0, 10);
  const existing = await first<{ id: string; request_hash: string }>(
    env.DB.prepare(
      `SELECT id,request_hash FROM quota_reservations
       WHERE owner_user_id=? AND capability=? AND idempotency_key=?`,
    ).bind(ownerUserId, capability, idempotencyKey),
  );
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { id: existing.id, statements: [] };
  }
  const used = await first<{ count: number }>(
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM quota_reservations
       WHERE usage_date=? AND owner_user_id=? AND capability=?`,
    ).bind(usageDate, ownerUserId, capability),
  );
  const slotNumber = nextQuotaSlot(
    used?.count ?? 0,
    quotaLimit(capability, {
      analysis: env.ANALYSIS_DAILY_QUOTA,
      generation: env.GENERATION_DAILY_QUOTA,
      export: env.EXPORT_DAILY_QUOTA,
    }),
  );
  if (slotNumber === null) {
    throw new HTTPException(429, {
      message: `本日の${capability === "analysis" ? "解析" : capability === "generation" ? "生成" : "エクスポート"}上限に達しました`,
    });
  }
  const id = await deriveUuid(env.AUTH_PEPPER, `quota:${ownerUserId}:${capability}:${idempotencyKey}`);
  const now = nowIso();
  return {
    id,
    statements: [
      env.DB.prepare(
        `INSERT INTO quota_reservations
          (id,usage_date,owner_user_id,capability,idempotency_key,request_hash,slot_number,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).bind(id, usageDate, ownerUserId, capability, idempotencyKey, requestHash, slotNumber, now),
      env.DB.prepare(
        `INSERT INTO usage_daily (usage_date,user_id,capability,accepted_count,updated_at)
         VALUES (?,?,?,1,?)
         ON CONFLICT(usage_date,user_id,capability)
         DO UPDATE SET accepted_count=accepted_count+1,updated_at=excluded.updated_at`,
      ).bind(usageDate, ownerUserId, capability, now),
    ],
  };
}
