export function selectModelRunMetadata(
  db: D1Database,
  bindings: readonly [
    ownerUserId: string,
    operation: string,
    rootRequestId: string,
    attemptNumber: number,
    provider: string,
  ],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM model_run_metadata
           WHERE owner_user_id=? AND operation=? AND root_request_id=? AND attempt_number=? AND provider=? LIMIT 1`)
    .bind(...bindings);
}
