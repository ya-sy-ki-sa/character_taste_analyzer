/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectQuotaReservations(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, capability: unknown, idempotencyKey: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,request_hash FROM quota_reservations
       WHERE owner_user_id=? AND capability=? AND idempotency_key=?`)
    .bind(...bindings);
}

export function selectQuotaReservations2(
  db: D1Database,
  bindings: readonly [usageDate: unknown, ownerUserId: unknown, capability: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT COUNT(*) AS count FROM quota_reservations
       WHERE usage_date=? AND owner_user_id=? AND capability=?`)
    .bind(...bindings);
}

export function insertQuotaReservations(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    usageDate: unknown,
    ownerUserId: unknown,
    capability: unknown,
    idempotencyKey: unknown,
    requestHash: unknown,
    slotNumber: unknown,
    now: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO quota_reservations
          (id,usage_date,owner_user_id,capability,idempotency_key,request_hash,slot_number,created_at)
         VALUES (?,?,?,?,?,?,?,?)`)
    .bind(...bindings);
}

export function insertUsageDaily(
  db: D1Database,
  bindings: readonly [usageDate: unknown, ownerUserId: unknown, capability: unknown, now: unknown],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO usage_daily (usage_date,user_id,capability,accepted_count,updated_at)
         VALUES (?,?,?,1,?)
         ON CONFLICT(usage_date,user_id,capability)
         DO UPDATE SET accepted_count=accepted_count+1,updated_at=excluded.updated_at`)
    .bind(...bindings);
}
