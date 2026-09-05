/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectGenerationRequests(
  db: D1Database,
  bindings: readonly [generationRequestId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`SELECT status FROM generation_requests WHERE id=? AND owner_user_id=? AND analysis_domain=?`)
    .bind(...bindings);
}

export function deleteGeneratedCharacters(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    generationRequestId: unknown,
    ownerUserId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserIdAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM generated_characters WHERE generation_request_id=? AND owner_user_id=? AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteGenerationValidationRuns(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    generationRequestId: unknown,
    ownerUserId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserIdAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM generation_validation_runs
       WHERE generation_request_id=? AND owner_user_id=? AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteGenerationBriefs(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    generationRequestId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserId: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM generation_briefs WHERE generation_request_id=? AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteGenerationRequestPreferences(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    generationRequestId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserId: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM generation_request_preferences WHERE generation_request_id=? AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteOutboxEvents(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    ownerUserId: unknown,
    ownerUserIdAgain: unknown,
    generationRequestId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserIdAgainAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM outbox_events WHERE owner_user_id=? AND aggregate_type='job'
       AND aggregate_id IN (
         SELECT id FROM jobs WHERE owner_user_id=? AND target_type='generation_request' AND target_id=?
       ) AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteJobs(
  db: D1Database,
  terminalGuard: string | number,
  bindings: readonly [
    ownerUserId: unknown,
    generationRequestId: unknown,
    generationRequestIdAgain: unknown,
    ownerUserIdAgain: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM jobs WHERE owner_user_id=? AND target_type='generation_request' AND target_id=?
       AND ${terminalGuard}`)
    .bind(...bindings);
}

export function deleteGenerationRequests(
  db: D1Database,
  bindings: readonly [generationRequestId: unknown, ownerUserId: unknown, analysisDomain: unknown],
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM generation_requests
       WHERE id=? AND owner_user_id=? AND analysis_domain=? AND status IN ('generated','failed','cancelled')`)
    .bind(...bindings);
}

export function terminalGuard(): string {
  return `EXISTS (
    SELECT 1 FROM generation_requests gr
    WHERE gr.id=? AND gr.owner_user_id=? AND gr.analysis_domain=? AND gr.status IN ('generated','failed','cancelled')
  )`;
}
