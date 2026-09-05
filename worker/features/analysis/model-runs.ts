import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { LlmProviderError, type LlmRunMetadata } from "../../llm/types";
import type { Env } from "../../types";
import * as repository from "./repositories/model-runs";
import type { CompletedLlmGroup } from "./types";

export async function persistModelRun(
  env: Env,
  ownerUserId: string,
  operation: string,
  inputHash: string,
  output: unknown,
  metadata: LlmRunMetadata,
  analysisDomain: AnalysisDomain = "standard",
): Promise<{ id: string; statement: D1PreparedStatement }> {
  operation = metadata.operation ?? operation;
  const id = crypto.randomUUID();
  const outputHash = await sha256Hex(JSON.stringify(output));
  return {
    id,
    statement: repository.insertModelRunMetadata(env.DB, [
      id,
      ownerUserId,
      metadata.provider,
      metadata.transport,
      metadata.adapterVersion,
      metadata.requestedModel,
      metadata.resolvedModel,
      operation,
      operation === "preference_hypotheses" ? `${operation}/v2.1.0` : `${operation}/v1.0.1`,
      operation === "preference_hypotheses" ? "2.1" : "1.0",
      metadata.providerRequestId ?? null,
      inputHash,
      outputHash,
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
    ]),
  };
}

export function completedLlmGroup(
  operation: string,
  inputHash: string,
  result: {
    value: unknown;
    metadata: LlmRunMetadata;
    attempts?: Array<{ output: unknown; metadata: LlmRunMetadata }>;
  },
): CompletedLlmGroup {
  return {
    operation,
    inputHash,
    attempts: result.attempts ?? [{ output: result.value, metadata: result.metadata }],
  };
}

export async function persistCompletedLlmGroupsOnFailure(
  env: Env,
  ownerUserId: string,
  groups: CompletedLlmGroup[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const group of groups) {
    for (const attempt of group.attempts) {
      const rootRequestId = attempt.metadata.rootRequestId ?? group.inputHash;
      const existing = await first<{ id: string }>(
        repository.selectModelRunMetadata(env.DB, [
          ownerUserId,
          group.operation,
          rootRequestId,
          attempt.metadata.attemptNumber ?? 0,
          attempt.metadata.provider,
        ]),
      );
      if (existing) continue;
      const run = await persistModelRun(
        env,
        ownerUserId,
        group.operation,
        group.inputHash,
        attempt.output,
        attempt.metadata,
      );
      statements.push(run.statement);
    }
  }
  if (!statements.length) return;
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_MODEL_RUN_PERSIST_FAILED");
}

export async function persistFailedModelRuns(env: Env, ownerUserId: string, error: unknown): Promise<void> {
  if (!(error instanceof LlmProviderError) || !error.attempts.length) return;
  const runs = await Promise.all(
    error.attempts.map((attempt) =>
      persistModelRun(
        env,
        ownerUserId,
        error.operation ?? "provider_attempt",
        attempt.metadata.promptHash ?? attempt.metadata.rootRequestId ?? "provider-failure",
        attempt.output,
        attempt.metadata,
      ),
    ),
  );
  const results = await env.DB.batch(runs.map((run) => run.statement));
  if (results.some((result) => !result.success)) throw new Error("D1_MODEL_RUN_PERSIST_FAILED");
}
