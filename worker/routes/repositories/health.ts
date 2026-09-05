/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function prepareQuery(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT 1 AS ready");
}
