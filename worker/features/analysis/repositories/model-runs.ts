/** D1 statements for this use case. Callers compose atomic batches across repositories. */
export function insertModelRunMetadata(
  db: D1Database,
  bindings: readonly [
    id: unknown,
    ownerUserId: unknown,
    provider: unknown,
    transport: unknown,
    adapterVersion: unknown,
    requestedModel: unknown,
    resolvedModel: unknown,
    operation: unknown,
    value8: unknown,
    value9: unknown,
    value10: unknown,
    inputHash: unknown,
    outputHash: unknown,
    value13: unknown,
    value14: unknown,
    latencyMs: unknown,
    value16: unknown,
    dataRetentionMode: unknown,
    value18: unknown,
    value19: unknown,
    value20: unknown,
    value21: unknown,
    value22: unknown,
    value23Json: unknown,
    value24Json: unknown,
    value25Json: unknown,
    value26: unknown,
    analysisDomain: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO model_run_metadata (
        id, owner_user_id, provider, transport, adapter_version, requested_model, resolved_model,
        operation, prompt_version, schema_version, provider_request_id, input_hash, output_hash,
        input_token_estimate, output_token_estimate, latency_ms, finish_reason, data_retention_mode,
        root_request_id,attempt_number,prompt_hash,fallback_from_provider,fallback_error_code,
        effective_settings_json,ignored_parameters_json,provider_response_diagnostics_json,created_at,analysis_domain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?, ?,?,?,?)
    `)
    .bind(...bindings);
}

export function selectModelRunMetadata(
  db: D1Database,
  bindings: readonly [
    ownerUserId: unknown,
    operation: unknown,
    rootRequestId: unknown,
    value3: unknown,
    provider: unknown,
  ],
): D1PreparedStatement {
  return db
    .prepare(`SELECT id FROM model_run_metadata
           WHERE owner_user_id=? AND operation=? AND root_request_id=? AND attempt_number=? AND provider=? LIMIT 1`)
    .bind(...bindings);
}
