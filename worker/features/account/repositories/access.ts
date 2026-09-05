/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectAccountExports(
  db: D1Database,
  bindings: readonly [value0: unknown, userId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,status,schema_version,byte_size,error_code,created_at,updated_at,completed_at,expires_at
       FROM account_exports WHERE id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function selectAccountExports2(
  db: D1Database,
  bindings: readonly [value0: unknown, userId: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT status,object_key,expires_at FROM account_exports WHERE id=? AND owner_user_id=?`)
    .bind(...bindings);
}

export function selectAccountExports3(db: D1Database, bindings: readonly [userId: unknown]): D1PreparedStatement {
  return db.prepare(`SELECT object_key FROM account_exports WHERE owner_user_id=?`).bind(...bindings);
}

export function deleteUsers(db: D1Database, bindings: readonly [userId: unknown]): D1PreparedStatement {
  return db.prepare(`DELETE FROM users WHERE id=?`).bind(...bindings);
}
