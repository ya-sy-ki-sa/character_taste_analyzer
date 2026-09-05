/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function updateOutboxEvents(
  db: D1Database,
  bindings: readonly [leaseOwner: unknown, leaseExpires: unknown, eventId: unknown, now: unknown, nowAgain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE outbox_events SET status='publishing',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1
     WHERE id=? AND status IN ('pending','deferred_capacity','publishing') AND available_at<=?
       AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempt_count<10`)
    .bind(...bindings);
}

export function selectOutboxEvents(
  db: D1Database,
  bindings: readonly [eventId: unknown, leaseOwner: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id,aggregate_id,payload_json,attempt_count FROM outbox_events WHERE id=? AND lease_owner=?`)
    .bind(...bindings);
}

export function updateJobs(
  db: D1Database,
  bindings: readonly [workflowId: unknown, completed: unknown, aggregate_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET workflow_instance_id=COALESCE(workflow_instance_id,?),updated_at=?
               WHERE id=? AND status IN ('queued','retrying')`)
    .bind(...bindings);
}

export function updateOutboxEvents2(
  db: D1Database,
  bindings: readonly [completed: unknown, eventId: unknown, leaseOwner: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE outbox_events SET status='published',published_at=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=?`)
    .bind(...bindings);
}

export function updateOutboxEvents3(
  db: D1Database,
  bindings: readonly [value0: unknown, next: unknown, code: unknown, eventId: unknown, leaseOwner: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE outbox_events SET status=?,available_at=?,last_error_code=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=?`)
    .bind(...bindings);
}

export function updateJobs2(
  db: D1Database,
  bindings: readonly [value0: unknown, value1: unknown, aggregate_id: unknown],
): D1PreparedStatement {
  return db
    .prepare(`UPDATE jobs SET status='failed',error_code='DISPATCH_EXHAUSTED',retryable=1,
               updated_at=?,completed_at=?,revision=revision+1
               WHERE id=? AND status IN ('queued','retrying')`)
    .bind(...bindings);
}

export function selectOutboxEvents2(
  db: D1Database,
  bindings: readonly [value0: unknown, value1: unknown, limit: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM outbox_events
       WHERE status IN ('pending','deferred_capacity','publishing') AND available_at<=?
         AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempt_count<10
       ORDER BY available_at,id LIMIT ?`)
    .bind(...bindings);
}

export function selectOutboxEvents3(
  db: D1Database,
  bindings: readonly [ownerUserId: unknown, value1: unknown, value2: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM outbox_events
       WHERE owner_user_id=? AND event_type='profile.rebuild'
         AND status IN ('pending','deferred_capacity','publishing') AND available_at<=?
         AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND attempt_count<10
       ORDER BY available_at,id LIMIT 1`)
    .bind(...bindings);
}
