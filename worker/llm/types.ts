import type { z } from "zod";

export type LlmTask =
  | "trait-extraction"
  | "profile-summary"
  | "character-generation"
  | "character-recommendation"
  | "feedback-extraction";

export type CanonicalMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type JsonSchema = Record<string, unknown>;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ModelArtifact<T> = {
  value: T;
  provider: string;
  model: string;
  usage: ModelUsage;
  latencyMs: number;
  fallbackFrom?: string[];
};

export type ProviderObjectRequest = {
  task: LlmTask;
  messages: CanonicalMessage[];
  schema: JsonSchema;
  model: string;
  promptVersion: string;
};

export type StructuredRequest<T> = {
  task: LlmTask;
  messages: CanonicalMessage[];
  schema: z.ZodType<T>;
  jsonSchema: JsonSchema;
  model: string;
  promptVersion: string;
  localFactory?: () => T | Promise<T>;
};

export interface StructuredLlmProvider {
  readonly id: string;
  generateObject<T>(request: ProviderObjectRequest): Promise<ModelArtifact<T>>;
}

export interface RawStructuredLlmProvider extends StructuredLlmProvider {
  readonly model: string;
  isAvailable(): boolean;
  generateRaw(request: Omit<StructuredRequest<unknown>, "schema" | "localFactory">): Promise<{
    value: unknown;
    rawText: string;
    usage: ModelUsage;
    latencyMs: number;
  }>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<{ vectors: number[][]; latencyMs: number }>;
}
