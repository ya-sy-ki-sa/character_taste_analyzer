import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso, sha256Hex } from "../../lib/crypto";
import type { LlmRunMetadata } from "../../llm/types";
import type { Env } from "../../types";
import * as repository from "./repositories/model-runs";

export async function persistModelRun(
  env: Env,
  ownerUserId: string,
  inputHash: string,
  output: unknown,
  metadata: LlmRunMetadata,
  operation = "character_generation",
  analysisDomain: AnalysisDomain = "standard",
): Promise<string> {
  operation = metadata.operation ?? operation;
  const id = crypto.randomUUID();
  await repository
    .insertModelRunMetadata(env.DB, [
      id,
      ownerUserId,
      metadata.provider,
      metadata.transport,
      metadata.adapterVersion,
      metadata.requestedModel,
      metadata.resolvedModel,
      operation,
      `${operation}/v1.0.0`,
      "1.0",
      metadata.providerRequestId ?? null,
      inputHash,
      await sha256Hex(JSON.stringify(output)),
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
      nowIso(),
      analysisDomain,
    ])
    .run();
  return id;
}
