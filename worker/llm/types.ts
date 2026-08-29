import type { z } from "zod";

export type LlmProviderId = "openai" | "workers_ai" | "replay" | "fake";
export type LlmOperation =
  | "character_understanding"
  | "customization_delta"
  | "preference_analysis"
  | "character_generation"
  | "schema_repair";

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export type StructuredLlmRequest<T> = {
  operation: LlmOperation;
  schemaName: string;
  schemaVersion: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  messages: LlmMessage[];
  maxOutputTokens: number;
  temperature: number;
  idempotencyKey: string;
  fakeFactory(): T;
};
export type LlmRunMetadata = {
  provider: LlmProviderId;
  transport: "direct" | "ai_gateway" | "binding" | "replay" | "fake";
  adapterVersion: string;
  requestedModel: string;
  resolvedModel: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  finishReason?: string;
  dataRetentionMode: "provider_default" | "no_retention" | "unknown";
};
export type StructuredLlmResult<T> = { value: T; metadata: LlmRunMetadata; fallbackFrom?: string };

export interface LlmProvider {
  readonly providerId: LlmProviderId;
  generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly safeDetail?: string,
  ) {
    super(message);
  }
}
