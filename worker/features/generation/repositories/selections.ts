/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectProfileSnapshotItems(
  db: D1Database,
  value1: string | number,
  value2: string | number,
  bindings: readonly unknown[],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM profile_snapshot_items WHERE profile_snapshot_id=?${value1} AND id IN (${value2})`)
    .bind(...bindings);
}
