import { sha256Hex } from "../lib/crypto";
import type { Env } from "../types";
import { ADAPTER_VERSION } from "./adapter-version";
import { OpenAiLlmProvider } from "./openai";
import {
  type LlmExecutionContext,
  type LlmReasoningEffort,
  type LlmRoute,
  resolveLlmRoutingSnapshot,
  selectLlmRoute,
} from "./routing";
import type { LlmProvider, LlmProviderId, LlmRunMetadata, StructuredLlmRequest, StructuredLlmResult } from "./types";
import { LlmProviderError } from "./types";
import { WorkersAiLlmProvider } from "./workers-ai";

class DeterministicProvider implements LlmProvider {
  constructor(
    readonly providerId: "replay" | "fake",
    private readonly model: string,
    private readonly effort?: LlmReasoningEffort,
  ) {}
  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    const started = Date.now();
    const value = request.schema.parse(await request.fakeFactory());
    const metadata: LlmRunMetadata = {
      provider: this.providerId,
      transport: this.providerId,
      adapterVersion: ADAPTER_VERSION,
      requestedModel: this.model,
      resolvedModel: `${this.providerId}-v1`,
      latencyMs: Date.now() - started,
      finishReason: "stop",
      dataRetentionMode: "no_retention",
      rootRequestId: request.idempotencyKey,
      attemptNumber: 0,
      promptHash: await sha256Hex(JSON.stringify(request.messages)),
      effectiveSettings: {
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
        safetyIdentifier: request.safetyIdentifier ?? null,
        reasoningEffort: null,
      },
      ignoredParameters: this.effort ? ["reasoningEffort"] : [],
    };
    return {
      value,
      metadata,
      attempts: [{ output: value, metadata }],
    };
  }
}

function provider(env: Env, route: LlmRoute): LlmProvider {
  if (route.provider === "workers_ai") return new WorkersAiLlmProvider(env, route.model, route.effort ?? undefined);
  if (route.provider === "openai") return new OpenAiLlmProvider(env, route.model, route.effort ?? undefined);
  return new DeterministicProvider(route.provider, route.model, route.effort ?? undefined);
}

class LlmProviderRouter implements LlmProvider {
  readonly providerId: LlmProviderId;
  constructor(
    private readonly env: Env,
    private readonly context: LlmExecutionContext,
  ) {
    this.providerId = context.snapshot.tier.primary.provider;
  }
  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    const { snapshot, jobId } = this.context;
    const route = selectLlmRoute(snapshot, request.operation, request.repairOfOperation);
    const primary = provider(this.env, route.primary);
    const annotate = (metadata: LlmRunMetadata): LlmRunMetadata => ({
      ...metadata,
      operation: request.operation,
      effectiveSettings: {
        ...metadata.effectiveSettings,
        llmRouting: {
          membershipTier: snapshot.membershipTier,
          operation: request.operation,
          effectiveOperation: route.effectiveOperation,
          selectionReason: route.selectionReason,
          policyVersion: snapshot.policyVersion,
          jobId: jobId ?? null,
          primary: route.primary,
          fallback: route.fallback,
        },
      },
    });
    const annotateResult = (result: StructuredLlmResult<T>): StructuredLlmResult<T> => ({
      ...result,
      metadata: annotate(result.metadata),
      attempts: (result.attempts ?? [{ output: result.value, metadata: result.metadata }]).map((attempt) => ({
        ...attempt,
        metadata: annotate(attempt.metadata),
      })),
    });
    const annotateError = (error: LlmProviderError) => {
      error.operation = request.operation;
      error.attempts = error.attempts.map((attempt) => ({ ...attempt, metadata: annotate(attempt.metadata) }));
      if (error.attemptMetadata) error.attemptMetadata = annotate(error.attemptMetadata);
    };
    try {
      return annotateResult(await primary.generateStructured(request));
    } catch (error) {
      if (!(error instanceof LlmProviderError)) throw error;
      annotateError(error);
      if (!error.retryable || !route.fallback) throw error;
      const fallback = provider(this.env, route.fallback);
      try {
        const result = annotateResult(
          await fallback.generateStructured({
            ...request,
            idempotencyKey: `${request.idempotencyKey}:fallback`,
          }),
        );
        const fallbackAttempts = (result.attempts ?? [{ output: result.value, metadata: result.metadata }]).map(
          (attempt) => ({
            ...attempt,
            metadata: {
              ...attempt.metadata,
              fallbackFromProvider: primary.providerId,
              fallbackErrorCode: error.code,
            },
          }),
        );
        return {
          ...result,
          metadata: { ...result.metadata, fallbackFromProvider: primary.providerId, fallbackErrorCode: error.code },
          attempts: [...error.attempts, ...fallbackAttempts],
          fallbackFrom: `${primary.providerId}:${error.code}`,
        };
      } catch (fallbackError) {
        if (fallbackError instanceof LlmProviderError) {
          annotateError(fallbackError);
          fallbackError.attempts = fallbackError.attempts.map((attempt) => ({
            ...attempt,
            metadata: { ...attempt.metadata, fallbackFromProvider: primary.providerId, fallbackErrorCode: error.code },
          }));
          fallbackError.attempts = [...error.attempts, ...fallbackError.attempts];
        }
        throw fallbackError;
      }
    }
  }
}

export function createLlmProvider(env: Env, context?: LlmExecutionContext): LlmProvider {
  return new LlmProviderRouter(env, context ?? { snapshot: resolveLlmRoutingSnapshot(env, "basic") });
}
