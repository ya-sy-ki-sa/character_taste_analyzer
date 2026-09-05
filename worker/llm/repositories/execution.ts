/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function selectJobs(
  db: D1Database,
  bindings: readonly [jobId: unknown, ownerUserId: unknown],
): D1PreparedStatement {
  return db
    .prepare(
      "SELECT llm_routing_snapshot_json FROM jobs WHERE id=? AND owner_user_id=? AND job_type IN ('character_analysis','generation')",
    )
    .bind(...bindings);
}
