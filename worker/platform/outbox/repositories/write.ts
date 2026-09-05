/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function insertOutboxEvents(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    aggregateType: unknown,
    aggregateId: unknown,
    aggregateRevision: unknown,
    type: unknown,
    payloadJson: unknown,
    value7: unknown,
    correlationId: unknown,
    deduplicationKey: unknown,
    now: unknown,
    nowAgain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO outbox_events
        (id,owner_user_id,aggregate_type,aggregate_id,aggregate_revision,event_type,event_version,
         payload_json,payload_hash,correlation_id,deduplication_key,status,attempt_count,available_at,created_at)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,'pending',0,?,?)`)
    .bind(...bindings);
}
