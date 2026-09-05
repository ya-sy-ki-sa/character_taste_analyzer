import { nowIso } from "../../lib/crypto";
import { LlmProviderError, type LlmRunMetadata } from "../../llm/types";
import { ProvenanceVerificationError } from "../../platform/provenance/sources";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import * as repository from "./repositories/failures";

export async function updateFailure(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  error: unknown,
  willRetry: boolean,
  metadata?: LlmRunMetadata,
) {
  const code = analysisErrorCode(error);
  const safe = safeAnalysisErrorDetail(error, metadata);
  const now = nowIso();
  await env.DB.batch([
    repository.updateJobs(env.DB, [
      willRetry ? "retrying" : "failed",
      willRetry ? 1 : 0,
      willRetry ? 1 : 0,
      code,
      safe?.slice(0, 2_000) ?? null,
      willRetry ? new Date(Date.now() + 5_000).toISOString() : null,
      now,
      willRetry ? null : now,
      params.jobId,
    ]),
    repository.updateUserCharacterEntries(env.DB, [
      willRetry ? (params.stage === "understanding" ? "understanding" : "analyzing") : "failed",
      now,
      params.entryId,
      params.ownerUserId,
      params.inputGeneration,
    ]),
  ]);
}

export function analysisErrorCode(error: unknown): string {
  if (error instanceof LlmProviderError || error instanceof ProvenanceVerificationError) return error.code;
  return error instanceof Error ? error.message : "ANALYSIS_FAILED";
}

export function analysisFailureMetadata(
  error: unknown,
  latestCompletedMetadata?: LlmRunMetadata,
): LlmRunMetadata | undefined {
  if (error instanceof LlmProviderError) {
    return error.attempts.at(-1)?.metadata ?? error.attemptMetadata ?? latestCompletedMetadata;
  }
  return latestCompletedMetadata;
}

export function safeAnalysisErrorDetail(error: unknown, metadata?: LlmRunMetadata): string | undefined {
  const base =
    error instanceof LlmProviderError || error instanceof ProvenanceVerificationError
      ? (error.safeDetail ?? error.message)
      : error instanceof Error
        ? error.message
        : undefined;
  if (!metadata) return base;
  const diagnostics = metadata.providerResponseDiagnostics;
  const responseClassificationLabels = {
    none: "検出なし",
    refusal: "拒否応答",
    content_filter: "コンテンツフィルター",
    provider_error: "Providerエラー",
    incomplete: "未完了",
  } as const;
  const safetySignal =
    diagnostics?.safetySignal === "refusal"
      ? "拒否応答あり"
      : diagnostics?.safetySignal === "content_filter"
        ? "コンテンツフィルターあり"
        : "検出なし";
  const maxOutputTokens = metadata.effectiveSettings?.maxOutputTokens;
  const providerDetail = [
    `Provider: ${metadata.provider}`,
    diagnostics?.requestId ? `ProviderリクエストID: ${diagnostics.requestId}` : null,
    diagnostics?.responseId ? `OpenAI応答ID: ${diagnostics.responseId}` : null,
    !diagnostics?.requestId && !diagnostics?.responseId && metadata.providerRequestId
      ? `Provider応答ID: ${metadata.providerRequestId}`
      : null,
    diagnostics?.responseStatus ? `応答状態: ${diagnostics.responseStatus}` : null,
    diagnostics?.safetySignal && diagnostics.safetySignal !== "none"
      ? `応答分類: ${responseClassificationLabels[diagnostics.safetySignal]}`
      : null,
    diagnostics ? `安全関連シグナル: ${safetySignal}` : null,
    metadata.outputTokens !== undefined
      ? `出力トークン: ${metadata.outputTokens}${typeof maxOutputTokens === "number" ? `／上限: ${maxOutputTokens}` : ""}`
      : typeof maxOutputTokens === "number"
        ? `出力トークン上限: ${maxOutputTokens}`
        : null,
    diagnostics?.errorCode ? `Providerエラーコード: ${diagnostics.errorCode}` : null,
    diagnostics?.incompleteReason && !base?.includes(diagnostics.incompleteReason)
      ? `未完了理由: ${diagnostics.incompleteReason}`
      : null,
  ]
    .filter(Boolean)
    .join("／");
  return [base, providerDetail].filter(Boolean).join("\n");
}
