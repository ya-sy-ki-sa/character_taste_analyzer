import { HTTPException } from "hono/http-exception";
import { deriveUuid, nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import { nextQuotaSlot, type QuotaCapability, quotaLimit } from "./policy";
import * as repository from "./repositories/reservations";

export type { QuotaCapability } from "./policy";

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
    repository.selectQuotaReservations(env.DB, [ownerUserId, capability, idempotencyKey]),
  );
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { id: existing.id, statements: [] };
  }
  const used = await first<{ count: number }>(
    repository.selectQuotaReservations2(env.DB, [usageDate, ownerUserId, capability]),
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
      repository.insertQuotaReservations(env.DB, [
        id,
        usageDate,
        ownerUserId,
        capability,
        idempotencyKey,
        requestHash,
        slotNumber,
        now,
      ]),
      repository.insertUsageDaily(env.DB, [usageDate, ownerUserId, capability, now]),
    ],
  };
}
