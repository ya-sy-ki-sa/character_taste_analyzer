/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function deleteUsers(
  db: D1Database,
  bindings: readonly [now: unknown, pendingCutoff: unknown],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM users WHERE status='pending' AND pending_expires_at<? AND pending_expires_at<?`)
    .bind(...bindings);
}

export function deleteRequestRateLimits(db: D1Database, bindings: readonly [now: unknown]): D1PreparedStatement {
  return db.prepare(`DELETE FROM request_rate_limits WHERE expires_at<?`).bind(...bindings);
}

export function deleteIdempotencyResponses(db: D1Database, bindings: readonly [now: unknown]): D1PreparedStatement {
  return db.prepare(`DELETE FROM idempotency_responses WHERE expires_at<?`).bind(...bindings);
}

export function deleteSessions(
  db: D1Database,
  bindings: readonly [now: unknown, pendingCutoff: unknown],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)`)
    .bind(...bindings);
}
