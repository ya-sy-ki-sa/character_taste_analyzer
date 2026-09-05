/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectSessions(
  db: D1Database,
  bindings: readonly [tokenDigest: unknown, value1: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
      SELECT s.id, s.user_id, u.username, u.membership_tier, s.csrf_digest, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN credentials c ON c.user_id = u.id
      WHERE s.token_digest = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        AND u.status = 'active'
    `)
    .bind(...bindings);
}

export function updateSessions(
  db: D1Database,
  bindings: readonly [expiresAt: unknown, now: unknown, id: unknown, expiresAtAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
        UPDATE sessions SET expires_at = ?, last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL AND expires_at = ?
      `)
    .bind(...bindings);
}

export function insertRequestRateLimits(
  db: D1Database,
  bindings: readonly [bucketKey: unknown, startedAt: unknown, expiresAt: unknown, value3: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    INSERT INTO request_rate_limits (bucket_key, window_started_at, request_count, expires_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
    RETURNING request_count AS count
  `)
    .bind(...bindings);
}

export function insertUsageDaily(
  db: D1Database,
  bindings: readonly [date: unknown, userId: unknown, capability: unknown, value3: unknown],
): D1PreparedStatement {
  return db
    .prepare(`
    INSERT INTO usage_daily (usage_date, user_id, capability, accepted_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(usage_date, user_id, capability)
    DO UPDATE SET accepted_count = accepted_count + 1, updated_at = excluded.updated_at
    RETURNING accepted_count AS count
  `)
    .bind(...bindings);
}

export function updateUsageDaily(
  db: D1Database,
  bindings: readonly [date: unknown, userId: unknown, capability: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE usage_daily SET accepted_count = accepted_count - 1, rejected_count = rejected_count + 1 WHERE usage_date = ? AND user_id = ? AND capability = ?`,
    )
    .bind(...bindings);
}
