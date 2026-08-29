import type { Env } from "../types";
import type {
  CanonicalMessage,
  EmbeddingProvider,
  JsonSchema,
  ModelArtifact,
  ModelUsage,
  ProviderObjectRequest,
  RawStructuredLlmProvider,
  StructuredRequest,
} from "./types";

class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly rawText = "",
  ) {
    super(message);
  }
}

function preferLocalDevelopment(env: Env): boolean {
  return (
    env.ENVIRONMENT === "development" && env.ALLOW_LOCAL_AI_FALLBACK === "true" && env.USE_REMOTE_AI_IN_DEV !== "true"
  );
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new ProviderError(`${label} timed out`, "timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next safe extraction strategy before requesting a model repair.
    }
  }
  throw new ProviderError("モデルの出力をJSONとして解釈できません", "invalid_json", text);
}

function responseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (!choice || typeof choice !== "object") continue;
      const message = (choice as { message?: unknown }).message;
      if (!message || typeof message !== "object") continue;
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") return content;
    }
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
      }
    }
  }
  throw new ProviderError("モデル応答にテキストがありません", "empty_response");
}

function safeSchemaName(task: string): string {
  return task.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 64);
}

function workersAiOptions(task: StructuredRequest<unknown>["task"]) {
  if (task === "character-generation") return { maxTokens: 4_000, temperature: 0.75, timeoutMs: 120_000 };
  if (task === "character-recommendation") return { maxTokens: 3_000, temperature: 0.6, timeoutMs: 90_000 };
  return { maxTokens: 2_000, temperature: 0.2, timeoutMs: 60_000 };
}

export class OpenAiResponsesProvider implements RawStructuredLlmProvider {
  readonly id = "openai";
  readonly model: string;

  constructor(private readonly env: Env) {
    this.model = env.OPENAI_MODEL;
  }

  isAvailable(): boolean {
    return Boolean(this.env.OPENAI_API_KEY) && !preferLocalDevelopment(this.env);
  }

  async generateObject<T>(request: ProviderObjectRequest): Promise<ModelArtifact<T>> {
    const result = await this.generateRaw({ ...request, jsonSchema: request.schema });
    return {
      value: result.value as T,
      provider: this.id,
      model: this.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  }

  async generateRaw(request: Omit<StructuredRequest<unknown>, "schema" | "localFactory">) {
    if (!this.env.OPENAI_API_KEY) throw new ProviderError("OpenAI API key is not configured", "provider_unavailable");
    const startedAt = Date.now();
    const baseUrl = (this.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/u, "");
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "cf-aig-collect-log-payload": "false",
        "cf-aig-skip-cache": "true",
        "cf-aig-request-timeout": "60000",
      },
      body: JSON.stringify({
        model: request.model || this.model,
        input: request.messages,
        store: false,
        reasoning: { effort: request.task === "character-generation" ? "medium" : "low" },
        text: {
          format: {
            type: "json_schema",
            name: safeSchemaName(request.task),
            strict: true,
            schema: request.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const apiError =
        payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : undefined;
      throw new ProviderError(
        typeof apiError?.message === "string" ? apiError.message : `OpenAI returned ${response.status}`,
        `openai_${response.status}`,
      );
    }
    const text = responseText(payload);
    const usage = (payload.usage ?? {}) as Record<string, unknown>;
    return {
      value: extractJson(text),
      rawText: text,
      usage: {
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
      },
      latencyMs: Date.now() - startedAt,
    };
  }
}

export class WorkersAiProvider implements RawStructuredLlmProvider {
  readonly id = "workers-ai";
  readonly model: string;

  constructor(private readonly env: Env) {
    this.model = env.WORKERS_AI_MODEL;
  }

  isAvailable(): boolean {
    return Boolean(this.env.AI) && !preferLocalDevelopment(this.env);
  }

  async generateObject<T>(request: ProviderObjectRequest): Promise<ModelArtifact<T>> {
    const result = await this.generateRaw({ ...request, jsonSchema: request.schema });
    return {
      value: result.value as T,
      provider: this.id,
      model: this.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  }

  async generateRaw(request: Omit<StructuredRequest<unknown>, "schema" | "localFactory">) {
    if (!this.env.AI) throw new ProviderError("Workers AI binding is not configured", "provider_unavailable");
    const startedAt = Date.now();
    const options = workersAiOptions(request.task);
    const payload = await withTimeout(
      this.env.AI.run(request.model || this.model, {
        messages: request.messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        response_format: {
          type: "json_schema",
          json_schema: request.jsonSchema,
        },
      }),
      options.timeoutMs,
      "Workers AI",
    );
    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    let raw: unknown = object.response ?? object.result;
    if (raw === undefined) {
      try {
        raw = responseText(object);
      } catch {
        raw = payload;
      }
    }
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const usageObject = (object.usage ?? {}) as Record<string, unknown>;
    return {
      value: typeof raw === "object" ? raw : extractJson(text),
      rawText: text,
      usage: {
        inputTokens: typeof usageObject.prompt_tokens === "number" ? usageObject.prompt_tokens : undefined,
        outputTokens: typeof usageObject.completion_tokens === "number" ? usageObject.completion_tokens : undefined,
      },
      latencyMs: Date.now() - startedAt,
    };
  }
}

export class ProviderRouter {
  private readonly providers: RawStructuredLlmProvider[];

  constructor(private readonly env: Env) {
    const openAi = new OpenAiResponsesProvider(env);
    const workersAi = new WorkersAiProvider(env);
    this.providers = env.ENVIRONMENT === "development" ? [workersAi, openAi] : [openAi, workersAi];
  }

  async generateObject<T>(request: StructuredRequest<T>): Promise<ModelArtifact<T>> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      if (!provider.isAvailable()) {
        errors.push(`${provider.id}:unavailable`);
        continue;
      }
      let messages = request.messages;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const raw = await provider.generateRaw({
            task: request.task,
            messages,
            jsonSchema: request.jsonSchema,
            model: provider.model,
            promptVersion: request.promptVersion,
          });
          const parsed = request.schema.safeParse(raw.value);
          if (!parsed.success) {
            console.warn(
              JSON.stringify({
                event: "llm_schema_validation_failed",
                task: request.task,
                provider: provider.id,
                model: provider.model,
                attempt: attempt + 1,
                issues: parsed.error.issues.slice(0, 12).map((issue) => ({
                  path: issue.path.join("."),
                  code: issue.code,
                  message: issue.message,
                })),
              }),
            );
            if (attempt === 0) {
              messages = repairMessages(request.messages, raw.rawText, parsed.error.issues);
              continue;
            }
            throw new ProviderError("構造化出力がスキーマを満たしません", "schema_validation", raw.rawText);
          }
          return {
            value: parsed.data,
            provider: provider.id,
            model: provider.model,
            usage: raw.usage,
            latencyMs: raw.latencyMs,
            fallbackFrom: errors.length ? [...errors] : undefined,
          };
        } catch (error) {
          const code = error instanceof ProviderError ? error.code : "request_failed";
          errors.push(`${provider.id}:${code}`);
          console.warn(
            JSON.stringify({
              event: "llm_provider_attempt_failed",
              task: request.task,
              provider: provider.id,
              model: provider.model,
              attempt: attempt + 1,
              code,
              error: error instanceof Error ? error.name : "unknown",
              message: error instanceof Error ? error.message.slice(0, 500) : undefined,
            }),
          );
          if (attempt === 0 && error instanceof ProviderError && error.code === "invalid_json") {
            messages = repairMessages(request.messages, error.rawText, [{ path: [], message: error.message }]);
            continue;
          }
          if (attempt === 0 && error instanceof ProviderError && error.code === "schema_validation") continue;
          break;
        }
      }
    }

    if (this.env.ALLOW_LOCAL_AI_FALLBACK === "true" && request.localFactory) {
      console.warn(
        JSON.stringify({
          event: "llm_local_fallback",
          task: request.task,
          providers: errors,
        }),
      );
      const startedAt = Date.now();
      const value = await request.localFactory();
      const parsed = request.schema.parse(value);
      return {
        value: parsed,
        provider: "local-deterministic",
        model: "local-v1",
        usage: {},
        latencyMs: Date.now() - startedAt,
        fallbackFrom: errors,
      };
    }
    throw new ProviderError(`利用可能なLLMがありません (${errors.join(", ")})`, "all_providers_failed");
  }
}

function repairMessages(
  original: CanonicalMessage[],
  invalidOutput: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): CanonicalMessage[] {
  const issueText = issues
    .slice(0, 12)
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  return [
    ...original,
    { role: "assistant", content: invalidOutput.slice(0, 8_000) },
    {
      role: "user",
      content: `直前のJSONは次の検証エラーを含みます。事実を追加せず、同じ根拠だけを使ってJSONを修正してください。\n${issueText}`,
    },
  ];
}

export class WorkersEmbeddingProvider implements EmbeddingProvider {
  readonly id = "workers-ai";
  readonly model: string;
  readonly dimensions = 1_024;

  constructor(private readonly env: Env) {
    this.model = env.EMBEDDING_MODEL;
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; latencyMs: number }> {
    const startedAt = Date.now();
    if (!this.env.AI || preferLocalDevelopment(this.env)) {
      if (this.env.ALLOW_LOCAL_AI_FALLBACK !== "true")
        throw new ProviderError("Embedding provider is unavailable", "provider_unavailable");
      return {
        vectors: texts.map((text) => deterministicEmbedding(text, this.dimensions)),
        latencyMs: Date.now() - startedAt,
      };
    }
    const payload = await withTimeout(this.env.AI.run(this.model, { text: texts }), 60_000, "Workers AI embedding");
    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const data: unknown = Array.isArray(object.data)
      ? object.data
      : object.result &&
          typeof object.result === "object" &&
          Array.isArray((object.result as Record<string, unknown>).data)
        ? (object.result as Record<string, unknown>).data
        : undefined;
    if (!Array.isArray(data) || !data.every((vector: unknown) => Array.isArray(vector)))
      throw new ProviderError("Embedding response is invalid", "invalid_embedding");
    return { vectors: data as number[][], latencyMs: Date.now() - startedAt };
  }
}

function deterministicEmbedding(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const normalized = text.normalize("NFKC").toLocaleLowerCase("ja-JP");
  const grams = Array.from(normalized).flatMap((_, index, chars) => [
    chars.slice(index, index + 2).join(""),
    chars[index],
  ]);
  for (const gram of grams) {
    let hash = 2_166_136_261;
    for (const character of gram) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }
    vector[Math.abs(hash) % dimensions] += hash % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export type { JsonSchema, ModelUsage };
