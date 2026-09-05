import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { LlmRunMetadata } from "../types";

/** Build the statement without executing it; the caller owns the commit boundary. */
export function insertModelRunMetadata(
  db: D1Database,
  record: {
    id: string;
    ownerUserId: string;
    operation: string;
    promptVersion: string;
    schemaVersion: string;
    inputHash: string;
    outputHash: string;
    metadata: LlmRunMetadata;
    createdAt: string;
    analysisDomain: AnalysisDomain;
  },
): D1PreparedStatement {
  const { metadata, inputHash } = record;
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
    .bind(
      record.id,
      record.ownerUserId,
      metadata.provider,
      metadata.transport,
      metadata.adapterVersion,
      metadata.requestedModel,
      metadata.resolvedModel,
      record.operation,
      record.promptVersion,
      record.schemaVersion,
      metadata.providerRequestId ?? null,
      inputHash,
      record.outputHash,
      metadata.inputTokens ?? null,
      metadata.outputTokens ?? null,
      metadata.latencyMs,
      metadata.finishReason ?? null,
      metadata.dataRetentionMode,
      metadata.rootRequestId ?? inputHash,
      metadata.attemptNumber ?? 0,
      metadata.promptHash ?? inputHash,
      metadata.fallbackFromProvider ?? null,
      metadata.fallbackErrorCode ?? null,
      JSON.stringify(metadata.effectiveSettings ?? {}),
      JSON.stringify(metadata.ignoredParameters ?? []),
      JSON.stringify(metadata.providerResponseDiagnostics ?? {}),
      record.createdAt,
      record.analysisDomain,
    );
}
