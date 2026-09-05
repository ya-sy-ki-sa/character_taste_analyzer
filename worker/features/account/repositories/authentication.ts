/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUsers(db: D1Database, bindings: readonly [userId: unknown]): D1PreparedStatement {
  return db
    .prepare(`SELECT id,username,username_normalized,status,pending_expires_at,membership_tier FROM users WHERE id=?`)
    .bind(...bindings);
}

export function selectUsers2(db: D1Database, bindings: readonly [normalized: unknown]): D1PreparedStatement {
  return db.prepare(`SELECT id FROM users WHERE username_normalized=?`).bind(...bindings);
}

export function insertUsers(
  db: D1Database,
  bindings: readonly [
    userId: unknown,
    username: unknown,
    normalized: unknown,
    expiresAt: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO users (id,username,username_normalized,status,is_public,pending_expires_at,created_at,updated_at) VALUES (?,?,?,'pending',1,?,?,?)`,
    )
    .bind(...bindings);
}

export function insertCredentials(
  db: D1Database,
  bindings: readonly [userId: unknown, digest: unknown, now: unknown],
): D1PreparedStatement {
  return db.prepare(`INSERT INTO credentials (user_id,key_digest,created_at) VALUES (?,?,?)`).bind(...bindings);
}

export function selectUsers3(db: D1Database, bindings: readonly [userId: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.key_digest,u.status,u.pending_expires_at,u.username,u.membership_tier FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.id=?`,
    )
    .bind(...bindings);
}

export function updateUsers(
  db: D1Database,
  bindings: readonly [now: unknown, nowAgain: unknown, userId: unknown],
): D1PreparedStatement {
  return db.prepare(`UPDATE users SET status='active',activated_at=?,updated_at=? WHERE id=?`).bind(...bindings);
}

export function selectUsers4(db: D1Database, bindings: readonly [value0: unknown]): D1PreparedStatement {
  return db
    .prepare(
      `SELECT u.id,u.username,u.membership_tier,c.key_digest FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.username_normalized=? AND u.status='active'`,
    )
    .bind(...bindings);
}

export function insertSessions(
  db: D1Database,
  bindings: readonly [
    value0: unknown,
    id: unknown,
    value2: unknown,
    value3: unknown,
    expiresAt: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sessions (id,user_id,token_digest,csrf_digest,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(...bindings);
}

export function updateSessions(
  db: D1Database,
  bindings: readonly [value0: unknown, value1: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE sessions SET revoked_at=?,revoke_reason='logout' WHERE token_digest=? AND revoked_at IS NULL`)
    .bind(...bindings);
}
