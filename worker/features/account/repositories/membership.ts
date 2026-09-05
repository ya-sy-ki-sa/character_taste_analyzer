/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectUsers(db: D1Database, bindings: readonly [ownerUserId: unknown]): D1PreparedStatement {
  return db.prepare("SELECT membership_tier FROM users WHERE id=?").bind(...bindings);
}
