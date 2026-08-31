import type { Env } from "../types";
import {
  type EmbeddingDocument,
  type EmbeddingProvider,
  EmbeddingProviderError,
  type EmbeddingProviderId,
  type EmbeddingVector,
} from "./types";

const MAX_BATCH_DOCUMENTS = 2_048;
const OPENAI_REQUEST_TIMEOUT_MS = 15 * 60_000;

function configuredDimensions(env: Env): number | undefined {
  const raw = env.EMBEDDING_DIMENSIONS?.trim();
  if (!raw) return undefined;
  const dimensions = Number(raw);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1)
    throw new EmbeddingProviderError(
      "Embeddingの次元数が不正です",
      "PROVIDER_CONFIGURATION_INVALID",
      false,
      "EMBEDDING_DIMENSIONS must be a positive integer",
    );
  return dimensions;
}

function validateDocuments(documents: EmbeddingDocument[]): void {
  if (documents.length > MAX_BATCH_DOCUMENTS)
    throw new EmbeddingProviderError(
      "一度にEmbeddingできる文書数を超えています",
      "EMBEDDING_INPUT_INVALID",
      false,
      `maximum batch size is ${MAX_BATCH_DOCUMENTS}`,
    );
  const ids = new Set<string>();
  for (const document of documents) {
    if (!document.id || ids.has(document.id))
      throw new EmbeddingProviderError(
        "Embedding文書IDが不正です",
        "EMBEDDING_INPUT_INVALID",
        false,
        "document IDs must be non-empty and unique",
      );
    if (!document.text.trim())
      throw new EmbeddingProviderError(
        "空の文書はEmbeddingできません",
        "EMBEDDING_INPUT_INVALID",
        false,
        `empty input: ${document.id}`,
      );
    ids.add(document.id);
  }
}

function validateValues(values: unknown, dimensions: number | undefined): number[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "number" || !Number.isFinite(value)))
    throw new EmbeddingProviderError("Embedding Providerの応答が不正です", "EXTERNAL_PROVIDER_INVALID_RESPONSE", false);
  if (dimensions !== undefined && values.length !== dimensions)
    throw new EmbeddingProviderError(
      "Embeddingの次元数が設定と一致しません",
      "EMBEDDING_DIMENSION_MISMATCH",
      false,
      `expected ${dimensions}, received ${values.length}`,
    );
  return values as number[];
}

function toVectors(
  documents: EmbeddingDocument[],
  embeddings: unknown[],
  model: string,
  dimensions: number | undefined,
): EmbeddingVector[] {
  if (embeddings.length !== documents.length)
    throw new EmbeddingProviderError(
      "Embedding Providerの応答件数が一致しません",
      "EXTERNAL_PROVIDER_INVALID_RESPONSE",
      false,
      `expected ${documents.length}, received ${embeddings.length}`,
    );
  return documents.map((document, index) => ({
    documentId: document.id,
    values: validateValues(embeddings[index], dimensions),
    model,
  }));
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "openai" as const;
  readonly dimensions?: number;

  constructor(
    private readonly env: Env,
    readonly model: string,
  ) {
    this.dimensions = configuredDimensions(env);
  }

  private endpoint(): string {
    if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_GATEWAY_ID)
      throw new EmbeddingProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(this.env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(this.env.AI_GATEWAY_GATEWAY_ID)}/openai/embeddings`;
  }

  async embed(documents: EmbeddingDocument[]): Promise<EmbeddingVector[]> {
    validateDocuments(documents);
    if (documents.length === 0) return [];
    if (!this.env.OPENAI_API_KEY)
      throw new EmbeddingProviderError("OpenAI API keyがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    if (!this.env.AI_GATEWAY_TOKEN)
      throw new EmbeddingProviderError("AI Gateway tokenがありません", "PROVIDER_CONFIGURATION_INVALID", false);

    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
          "cf-aig-collect-log-payload": "false",
          "cf-aig-skip-cache": "true",
          "cf-aig-request-timeout": String(OPENAI_REQUEST_TIMEOUT_MS),
        },
        body: JSON.stringify({
          model: this.model,
          input: documents.map((document) => document.text),
          encoding_format: "float",
          ...(this.dimensions === undefined ? {} : { dimensions: this.dimensions }),
        }),
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmbeddingProviderError(
        "OpenAI Embeddings APIへ接続できません",
        "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        error instanceof Error ? error.message.slice(0, 500) : undefined,
      );
    }

    const payload = await response.json<unknown>().catch(() => ({}));
    if (!response.ok) {
      const capacity = response.status === 429;
      throw new EmbeddingProviderError(
        "OpenAIがEmbeddingリクエストを処理できません",
        capacity
          ? "PROVIDER_CAPACITY_EXHAUSTED"
          : response.status >= 500
            ? "EXTERNAL_PROVIDER_UNAVAILABLE"
            : "EXTERNAL_PROVIDER_REJECTED",
        capacity || response.status >= 500,
        `HTTP ${response.status}`,
      );
    }

    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    if (!Array.isArray(object.data))
      throw new EmbeddingProviderError(
        "OpenAI Embeddings APIの応答が不正です",
        "EXTERNAL_PROVIDER_INVALID_RESPONSE",
        false,
      );
    const indexed = new Map<number, unknown>();
    for (const item of object.data) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.index === "number" && Number.isInteger(record.index))
        indexed.set(record.index, record.embedding);
    }
    return toVectors(
      documents,
      documents.map((_, index) => indexed.get(index)),
      typeof object.model === "string" ? object.model : this.model,
      this.dimensions,
    );
  }
}

class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "workers_ai" as const;
  readonly dimensions?: number;

  constructor(
    private readonly env: Env,
    readonly model: string,
  ) {
    this.dimensions = configuredDimensions(env);
  }

  async embed(documents: EmbeddingDocument[]): Promise<EmbeddingVector[]> {
    validateDocuments(documents);
    if (documents.length === 0) return [];
    if (!this.env.AI)
      throw new EmbeddingProviderError("Workers AI bindingがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    if (!this.env.AI_GATEWAY_GATEWAY_ID)
      throw new EmbeddingProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    let payload: unknown;
    try {
      payload = await this.env.AI.run(
        this.model,
        { text: documents.map((document) => document.text) },
        { gateway: { id: this.env.AI_GATEWAY_GATEWAY_ID } },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Workers AI request failed";
      const capacity = /429|quota|limit|capacity|daily/iu.test(detail);
      throw new EmbeddingProviderError(
        "Workers AIでEmbeddingできません",
        capacity ? "PROVIDER_CAPACITY_EXHAUSTED" : "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        detail.slice(0, 500),
      );
    }
    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = object.result && typeof object.result === "object" ? (object.result as Record<string, unknown>) : {};
    const raw = object.data ?? result.data;
    const embeddings =
      documents.length === 1 && Array.isArray(raw) && raw.every((value) => typeof value === "number") ? [raw] : raw;
    if (!Array.isArray(embeddings))
      throw new EmbeddingProviderError(
        "Workers AIのEmbedding応答が不正です",
        "EXTERNAL_PROVIDER_INVALID_RESPONSE",
        false,
      );
    return toVectors(documents, embeddings, this.model, this.dimensions);
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "fake" as const;
  readonly dimensions: number;

  constructor(
    readonly model: string,
    dimensions: number | undefined,
  ) {
    this.dimensions = dimensions ?? 8;
  }

  async embed(documents: EmbeddingDocument[]): Promise<EmbeddingVector[]> {
    validateDocuments(documents);
    return documents.map((document) => {
      let seed = 2_166_136_261;
      for (const character of document.text) seed = Math.imul(seed ^ (character.codePointAt(0) ?? 0), 16_777_619) >>> 0;
      const values = Array.from({ length: this.dimensions }, (_, index) => {
        seed = (Math.imul(seed ^ index, 1_664_525) + 1_013_904_223) >>> 0;
        return seed / 0xffffffff - 0.5;
      });
      const magnitude = Math.hypot(...values) || 1;
      return { documentId: document.id, values: values.map((value) => value / magnitude), model: this.model };
    });
  }
}

export function createEmbeddingProvider(env: Env): EmbeddingProvider {
  const id: EmbeddingProviderId = env.EMBEDDING_PROVIDER;
  const model = env.EMBEDDING_MODEL?.trim();
  if (!model)
    throw new EmbeddingProviderError("Embedding modelが設定されていません", "PROVIDER_CONFIGURATION_INVALID", false);
  const dimensions = configuredDimensions(env);
  if (id === "openai") {
    if (!env.OPENAI_API_KEY)
      throw new EmbeddingProviderError("OpenAI API keyがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    return new OpenAiEmbeddingProvider(env, model);
  }
  if (id === "workers_ai") {
    if (!env.AI)
      throw new EmbeddingProviderError("Workers AI bindingがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    return new WorkersAiEmbeddingProvider(env, model);
  }
  return new FakeEmbeddingProvider(model, dimensions);
}
