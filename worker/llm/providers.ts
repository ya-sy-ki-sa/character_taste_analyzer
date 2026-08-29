import type { Env } from "../types";
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderId,
  LlmRunMetadata,
  StructuredLlmRequest,
  StructuredLlmResult,
} from "./types";
import { LlmProviderError } from "./types";

const ADAPTER_VERSION = "1.0.0";

function extractText(payload: unknown): {
  text: string;
  requestId?: string;
  usage?: Record<string, unknown>;
  finishReason?: string;
} {
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (typeof object.response === "string")
    return { text: object.response, usage: object.usage as Record<string, unknown> };
  if (typeof object.output_text === "string")
    return {
      text: object.output_text,
      requestId: typeof object.id === "string" ? object.id : undefined,
      usage: object.usage as Record<string, unknown>,
    };
  if (Array.isArray(object.choices)) {
    const choice = object.choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string")
      return {
        text: message.content,
        usage: object.usage as Record<string, unknown>,
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
      };
  }
  if (Array.isArray(object.output)) {
    for (const item of object.output as Array<Record<string, unknown>>) {
      if (!Array.isArray(item.content)) continue;
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (typeof part.text === "string")
          return {
            text: part.text,
            requestId: typeof object.id === "string" ? object.id : undefined,
            usage: object.usage as Record<string, unknown>,
          };
      }
    }
  }
  if (object.result && typeof object.result === "object") return extractText(object.result);
  if (payload && typeof payload === "object")
    return { text: JSON.stringify(payload), usage: object.usage as Record<string, unknown> };
  throw new LlmProviderError("モデル応答が空です", "EXTERNAL_PROVIDER_INVALID_RESPONSE", false);
}

function parseJson(text: string): unknown {
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded extraction form.
    }
  }
  throw new LlmProviderError("モデル応答をJSONとして解釈できません", "LLM_SCHEMA_INVALID", false);
}

function token(usage: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof usage?.[key] === "number") return usage[key];
  return undefined;
}

function repairMessages(messages: LlmMessage[], invalid: string, issues: string): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: invalid.slice(0, 8_000) },
    {
      role: "user",
      content: `直前のJSONだけを次の検証エラーに合わせて修正してください。事実を追加しないでください。\n${issues.slice(0, 3_000)}`,
    },
  ];
}

abstract class RemoteProvider implements LlmProvider {
  abstract readonly providerId: LlmProviderId;
  abstract invoke<T>(
    request: StructuredLlmRequest<T>,
    messages: LlmMessage[],
  ): Promise<{ text: string; metadata: LlmRunMetadata }>;

  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    let messages = request.messages;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.invoke(request, messages);
      const raw = parseJson(response.text);
      const parsed = request.schema.safeParse(raw);
      if (parsed.success) return { value: parsed.data, metadata: response.metadata };
      if (attempt === 1)
        throw new LlmProviderError(
          "構造化出力が契約を満たしません",
          "LLM_SCHEMA_INVALID",
          false,
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")
            .slice(0, 1_000),
        );
      messages = repairMessages(
        messages,
        response.text,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
      );
    }
    throw new LlmProviderError("構造化出力に失敗しました", "LLM_SCHEMA_INVALID", false);
  }
}

class WorkersAiLlmProvider extends RemoteProvider {
  readonly providerId = "workers_ai" as const;
  constructor(
    private readonly env: Env,
    private readonly model: string,
  ) {
    super();
  }

  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[]) {
    if (!this.env.AI)
      throw new LlmProviderError("Workers AI bindingがありません", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const started = Date.now();
    let payload: unknown;
    try {
      payload = await this.env.AI.run(this.model, {
        messages,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        response_format: { type: "json_schema", json_schema: request.jsonSchema },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workers AI request failed";
      const capacity = /429|quota|limit|capacity|daily/iu.test(message);
      throw new LlmProviderError(
        "解析Providerを利用できません",
        capacity ? "PROVIDER_CAPACITY_EXHAUSTED" : "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        message.slice(0, 500),
      );
    }
    const normalized = extractText(payload);
    return {
      text: normalized.text,
      metadata: {
        provider: this.providerId,
        transport: "binding" as const,
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        inputTokens: token(normalized.usage, "prompt_tokens", "input_tokens"),
        outputTokens: token(normalized.usage, "completion_tokens", "output_tokens"),
        latencyMs: Date.now() - started,
        finishReason: normalized.finishReason,
        dataRetentionMode: "unknown" as const,
      },
    };
  }
}

class OpenAiLlmProvider extends RemoteProvider {
  readonly providerId = "openai" as const;
  constructor(
    private readonly env: Env,
    private readonly model: string,
  ) {
    super();
  }

  private endpoint(): string {
    if (this.env.OPENAI_TRANSPORT !== "ai_gateway") return "https://api.openai.com/v1/responses";
    if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_GATEWAY_ID)
      throw new LlmProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(this.env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(this.env.AI_GATEWAY_GATEWAY_ID)}/openai/v1/responses`;
  }

  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[]) {
    if (!this.env.OPENAI_API_KEY)
      throw new LlmProviderError("OpenAI API keyがありません", "EXTERNAL_PROVIDER_UNAVAILABLE", false);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey,
          "cf-aig-collect-log-payload": "false",
          "cf-aig-skip-cache": "true",
        },
        body: JSON.stringify({
          model: this.model,
          input: messages,
          store: false,
          max_output_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          ...(request.enableWebSearch
            ? {
                tools: [{ type: this.env.OPENAI_TRANSPORT === "ai_gateway" ? "web_search_preview" : "web_search" }],
                tool_choice: "auto",
                max_tool_calls: 3,
                include: ["web_search_call.action.sources"],
              }
            : {}),
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName.replace(/[^a-z0-9_-]/giu, "_").slice(0, 64),
              strict: true,
              schema: request.jsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new LlmProviderError(
        "OpenAIへ接続できません",
        "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        error instanceof Error ? error.message.slice(0, 500) : undefined,
      );
    }
    const payload = await response.json<unknown>().catch(() => ({}));
    if (!response.ok) {
      const capacity = response.status === 429;
      throw new LlmProviderError(
        "OpenAIがリクエストを処理できません",
        capacity
          ? "PROVIDER_CAPACITY_EXHAUSTED"
          : response.status >= 500
            ? "EXTERNAL_PROVIDER_UNAVAILABLE"
            : "EXTERNAL_PROVIDER_REJECTED",
        capacity || response.status >= 500,
        `HTTP ${response.status}`,
      );
    }
    const normalized = extractText(payload);
    return {
      text: normalized.text,
      metadata: {
        provider: this.providerId,
        transport: this.env.OPENAI_TRANSPORT === "ai_gateway" ? ("ai_gateway" as const) : ("direct" as const),
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        providerRequestId: normalized.requestId,
        inputTokens: token(normalized.usage, "input_tokens"),
        outputTokens: token(normalized.usage, "output_tokens"),
        latencyMs: Date.now() - started,
        finishReason: normalized.finishReason,
        dataRetentionMode: "no_retention" as const,
      },
    };
  }
}

class DeterministicProvider implements LlmProvider {
  constructor(readonly providerId: "replay" | "fake") {}
  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    const started = Date.now();
    const value = request.schema.parse(await request.fakeFactory());
    return {
      value,
      metadata: {
        provider: this.providerId,
        transport: this.providerId,
        adapterVersion: ADAPTER_VERSION,
        requestedModel: `${this.providerId}-v1`,
        resolvedModel: `${this.providerId}-v1`,
        latencyMs: Date.now() - started,
        finishReason: "stop",
        dataRetentionMode: "no_retention",
      },
    };
  }
}

function provider(env: Env, id: LlmProviderId, model: string): LlmProvider {
  if (id === "workers_ai") return new WorkersAiLlmProvider(env, model);
  if (id === "openai") return new OpenAiLlmProvider(env, model);
  return new DeterministicProvider(id);
}

class LlmProviderRouter implements LlmProvider {
  readonly providerId: LlmProviderId;
  private readonly primary: LlmProvider;
  private readonly fallback?: LlmProvider;
  constructor(env: Env) {
    this.providerId = env.LLM_PROVIDER;
    this.primary = provider(env, env.LLM_PROVIDER, env.LLM_MODEL);
    if (env.LLM_FALLBACK_PROVIDER && env.LLM_FALLBACK_PROVIDER !== env.LLM_PROVIDER && env.LLM_FALLBACK_MODEL) {
      this.fallback = provider(env, env.LLM_FALLBACK_PROVIDER, env.LLM_FALLBACK_MODEL);
    }
  }
  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    try {
      return await this.primary.generateStructured(request);
    } catch (error) {
      if (!(error instanceof LlmProviderError) || !error.retryable || !this.fallback) throw error;
      const result = await this.fallback.generateStructured(request);
      return { ...result, fallbackFrom: `${this.primary.providerId}:${error.code}` };
    }
  }
}

export function createLlmProvider(env: Env): LlmProvider {
  return new LlmProviderRouter(env);
}
