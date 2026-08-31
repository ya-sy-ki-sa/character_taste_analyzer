import type { Env } from "../types";
import { sha256Hex } from "../lib/crypto";
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderId,
  LlmRunMetadata,
  StructuredLlmRequest,
  StructuredLlmResult,
} from "./types";
import { LlmProviderError } from "./types";

const ADAPTER_VERSION = "1.2.0";
const OPENAI_REQUEST_TIMEOUT_MS = 15 * 60_000;
const OPENAI_SERVICE_TIER = "flex" as const;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function openAiResponseDiagnostics(
  payload: unknown,
  httpStatus: number,
  requestId?: string,
): NonNullable<LlmRunMetadata["providerResponseDiagnostics"]> {
  const response = objectValue(payload);
  const error = objectValue(response.error);
  const incomplete = objectValue(response.incomplete_details);
  let refusal: string | undefined;
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      const output = objectValue(item);
      if (!Array.isArray(output.content)) continue;
      for (const content of output.content) {
        const part = objectValue(content);
        if (part.type === "refusal" && typeof part.refusal === "string") refusal = part.refusal.slice(0, 1_000);
      }
    }
  }
  const responseStatus = typeof response.status === "string" ? response.status : undefined;
  const errorCode = typeof error.code === "string" ? error.code : undefined;
  const errorMessage = typeof error.message === "string" ? error.message.slice(0, 1_000) : undefined;
  const incompleteReason = typeof incomplete.reason === "string" ? incomplete.reason : undefined;
  const signalText = [errorCode, errorMessage, incompleteReason].filter(Boolean).join(" ");
  const safetySignal = /content[_ -]?filter|safety|policy[_ -]?violation|moderation/iu.test(signalText)
    ? "content_filter"
    : refusal
      ? "refusal"
      : errorCode || errorMessage
        ? "provider_error"
        : responseStatus === "incomplete"
          ? "incomplete"
          : "none";
  return {
    httpStatus,
    requestId,
    responseId: typeof response.id === "string" ? response.id : undefined,
    responseStatus,
    errorCode,
    errorMessage,
    incompleteReason,
    refusal,
    safetySignal,
  };
}

function extractText(payload: unknown): {
  text: string;
  requestId?: string;
  usage?: Record<string, unknown>;
  finishReason?: string;
  citations?: Array<{ url: string; title: string }>;
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
    const citations = new Map<string, { url: string; title: string }>();
    for (const item of object.output as Array<Record<string, unknown>>) {
      const action = item.action as Record<string, unknown> | undefined;
      if (Array.isArray(action?.sources))
        for (const source of action.sources as Array<Record<string, unknown>>) {
          if (typeof source.url === "string")
            citations.set(source.url, {
              url: source.url,
              title: typeof source.title === "string" ? source.title : source.url,
            });
        }
      if (!Array.isArray(item.content)) continue;
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (Array.isArray(part.annotations))
          for (const annotation of part.annotations as Array<Record<string, unknown>>) {
            const url = typeof annotation.url === "string" ? annotation.url : undefined;
            if (url)
              citations.set(url, {
                url,
                title: typeof annotation.title === "string" ? annotation.title : url,
              });
          }
        if (typeof part.text === "string")
          return {
            text: part.text,
            requestId: typeof object.id === "string" ? object.id : undefined,
            usage: object.usage as Record<string, unknown>,
            citations: [...citations.values()],
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
  const excerpt = [...text]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
  throw new LlmProviderError(
    "モデル応答をJSONとして解釈できません",
    "LLM_SCHEMA_INVALID",
    false,
    excerpt ? `JSONとして解釈できなかったモデル応答: ${excerpt}` : "モデル応答の本文が空でした",
  );
}

function token(usage: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof usage?.[key] === "number") return usage[key];
  return undefined;
}

function openAiCompatibleJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openAiCompatibleJsonSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$schema") continue;
    if (key === "format" && item === "uri") continue;
    result[key] = openAiCompatibleJsonSchema(item);
  }
  return result;
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
    idempotencyKey: string,
  ): Promise<{ text: string; metadata: LlmRunMetadata }>;

  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    let messages = request.messages;
    const attempts: Array<{ output: unknown; metadata: LlmRunMetadata }> = [];
    const rootRequestId = request.idempotencyKey;
    const promptHash = await sha256Hex(JSON.stringify(request.messages));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const suffix = attempt === 0 ? ":attempt-0" : ":repair-1";
      let response: { text: string; metadata: LlmRunMetadata };
      try {
        response = await this.invoke(request, messages, `${rootRequestId}${suffix}`);
      } catch (error) {
        if (error instanceof LlmProviderError) {
          if (error.attemptMetadata) {
            attempts.push({
              output: { errorCode: error.code, safeDetail: error.safeDetail ?? null },
              metadata: { ...error.attemptMetadata, rootRequestId, attemptNumber: attempt, promptHash },
            });
          }
          error.attempts = [...attempts, ...error.attempts];
          error.operation = request.operation;
        }
        throw error;
      }
      const metadata = {
        ...response.metadata,
        rootRequestId,
        attemptNumber: attempt,
        promptHash,
      };
      let raw: unknown;
      try {
        raw = parseJson(response.text);
      } catch (error) {
        if (error instanceof LlmProviderError) {
          attempts.push({ output: { errorCode: error.code, safeDetail: error.safeDetail ?? error.message }, metadata });
          error.attempts = attempts;
          error.operation = request.operation;
        }
        throw error;
      }
      attempts.push({ output: raw, metadata });
      const parsed = request.schema.safeParse(raw);
      if (parsed.success) return { value: parsed.data, metadata, attempts };
      if (attempt === 1) {
        const error = new LlmProviderError(
          "構造化出力が契約を満たしません",
          "LLM_SCHEMA_INVALID",
          false,
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")
            .slice(0, 1_000),
        );
        error.attempts = attempts;
        error.operation = request.operation;
        throw error;
      }
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

  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[], _idempotencyKey: string) {
    if (!this.env.AI)
      throw new LlmProviderError("Workers AI bindingがありません", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    if (!this.env.AI_GATEWAY_GATEWAY_ID)
      throw new LlmProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    const started = Date.now();
    let payload: unknown;
    try {
      payload = await this.env.AI.run(
        this.model,
        {
          messages,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          response_format: { type: "json_schema", json_schema: request.jsonSchema },
        },
        { gateway: { id: this.env.AI_GATEWAY_GATEWAY_ID } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workers AI request failed";
      const capacity = /429|quota|limit|capacity|daily/iu.test(message);
      const providerError = new LlmProviderError(
        "解析Providerを利用できません",
        capacity ? "PROVIDER_CAPACITY_EXHAUSTED" : "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        message.slice(0, 500),
      );
      providerError.attemptMetadata = {
        provider: this.providerId,
        transport: "ai_gateway",
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        providerRequestId:
          payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string"
            ? payload.id
            : undefined,
        latencyMs: Date.now() - started,
        dataRetentionMode: "unknown",
        effectiveSettings: { maxOutputTokens: request.maxOutputTokens, temperature: request.temperature },
        ignoredParameters: [],
      };
      throw providerError;
    }
    const normalized = extractText(payload);
    return {
      text: normalized.text,
      metadata: {
        provider: this.providerId,
        transport: "ai_gateway" as const,
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
    if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_GATEWAY_ID)
      throw new LlmProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(this.env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(this.env.AI_GATEWAY_GATEWAY_ID)}/openai/responses`;
  }

  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[], idempotencyKey: string) {
    if (!this.env.OPENAI_API_KEY)
      throw new LlmProviderError("OpenAI API keyがありません", "EXTERNAL_PROVIDER_UNAVAILABLE", false);
    if (!this.env.AI_GATEWAY_TOKEN)
      throw new LlmProviderError("AI Gateway tokenがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "cf-aig-collect-log-payload": "false",
          "cf-aig-skip-cache": "true",
          "cf-aig-request-timeout": String(OPENAI_REQUEST_TIMEOUT_MS),
        },
        body: JSON.stringify({
          model: this.model,
          service_tier: OPENAI_SERVICE_TIER,
          input: messages,
          store: false,
          ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier.slice(0, 64) } : {}),
          max_output_tokens: request.maxOutputTokens,
          ...(request.enableWebSearch
            ? {
                tools: [{ type: "web_search" }],
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
              schema: openAiCompatibleJsonSchema(request.jsonSchema),
            },
          },
        }),
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const providerError = new LlmProviderError(
        "OpenAIへ接続できません",
        "EXTERNAL_PROVIDER_UNAVAILABLE",
        true,
        error instanceof Error ? error.message.slice(0, 500) : undefined,
      );
      providerError.attemptMetadata = {
        provider: this.providerId,
        transport: "ai_gateway",
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        latencyMs: Date.now() - started,
        dataRetentionMode: "no_retention",
        effectiveSettings: {
          maxOutputTokens: request.maxOutputTokens,
          serviceTier: OPENAI_SERVICE_TIER,
          webSearch: request.enableWebSearch === true,
          safetyIdentifier: request.safetyIdentifier ?? null,
        },
        ignoredParameters: ["temperature"],
      };
      throw providerError;
    }
    const payload = await response.json<unknown>().catch(() => ({}));
    const diagnostics = openAiResponseDiagnostics(
      payload,
      response.status,
      response.headers.get("x-request-id") ?? undefined,
    );
    const normalizedUsage =
      payload && typeof payload === "object" && "usage" in payload
        ? ((payload as { usage?: Record<string, unknown> }).usage ?? undefined)
        : undefined;
    if (!response.ok) {
      const capacity = response.status === 429;
      const errorObject =
        payload && typeof payload === "object" && "error" in payload
          ? ((payload as { error?: unknown }).error as Record<string, unknown> | undefined)
          : undefined;
      const providerCode = typeof errorObject?.code === "string" ? errorObject.code : undefined;
      const providerType = typeof errorObject?.type === "string" ? errorObject.type : undefined;
      const providerMessage = typeof errorObject?.message === "string" ? errorObject.message : undefined;
      const providerError = new LlmProviderError(
        "OpenAIがリクエストを処理できません",
        capacity
          ? "PROVIDER_CAPACITY_EXHAUSTED"
          : response.status >= 500
            ? "EXTERNAL_PROVIDER_UNAVAILABLE"
            : "EXTERNAL_PROVIDER_REJECTED",
        capacity || response.status >= 500,
        [`HTTP ${response.status}`, providerCode, providerType, providerMessage?.slice(0, 300)]
          .filter(Boolean)
          .join(": "),
      );
      providerError.attemptMetadata = {
        provider: this.providerId,
        transport: "ai_gateway",
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        providerRequestId: diagnostics.requestId ?? diagnostics.responseId,
        inputTokens: token(normalizedUsage, "input_tokens"),
        outputTokens: token(normalizedUsage, "output_tokens"),
        latencyMs: Date.now() - started,
        dataRetentionMode: "no_retention",
        effectiveSettings: {
          maxOutputTokens: request.maxOutputTokens,
          serviceTier: OPENAI_SERVICE_TIER,
          webSearch: request.enableWebSearch === true,
          safetyIdentifier: request.safetyIdentifier ?? null,
        },
        ignoredParameters: ["temperature"],
        providerResponseDiagnostics: diagnostics,
      };
      throw providerError;
    }
    const providerRequestId = diagnostics.requestId ?? diagnostics.responseId;
    const attemptMetadata: LlmRunMetadata = {
      provider: this.providerId,
      transport: "ai_gateway",
      adapterVersion: ADAPTER_VERSION,
      requestedModel: this.model,
      resolvedModel: this.model,
      providerRequestId,
      inputTokens: token(normalizedUsage, "input_tokens"),
      outputTokens: token(normalizedUsage, "output_tokens"),
      latencyMs: Date.now() - started,
      dataRetentionMode: "no_retention",
      effectiveSettings: {
        maxOutputTokens: request.maxOutputTokens,
        serviceTier: OPENAI_SERVICE_TIER,
        webSearch: request.enableWebSearch === true,
        safetyIdentifier: request.safetyIdentifier ?? null,
      },
      ignoredParameters: ["temperature"],
      providerResponseDiagnostics: diagnostics,
    };
    if (diagnostics.refusal) {
      const providerError = new LlmProviderError(
        "OpenAIが回答を拒否しました",
        "EXTERNAL_PROVIDER_REFUSED",
        false,
        `OpenAIの拒否応答: ${diagnostics.refusal}`,
      );
      providerError.attemptMetadata = attemptMetadata;
      throw providerError;
    }
    if (diagnostics.errorCode || diagnostics.errorMessage || diagnostics.responseStatus === "failed") {
      const providerError = new LlmProviderError(
        "OpenAIが回答の生成に失敗しました",
        "EXTERNAL_PROVIDER_REJECTED",
        false,
        [diagnostics.errorCode, diagnostics.errorMessage].filter(Boolean).join(": ") || "応答状態がfailedでした",
      );
      providerError.attemptMetadata = attemptMetadata;
      throw providerError;
    }
    if (diagnostics.responseStatus === "incomplete") {
      const providerError = new LlmProviderError(
        "OpenAIの回答が未完了でした",
        "EXTERNAL_PROVIDER_INCOMPLETE",
        false,
        `未完了理由: ${diagnostics.incompleteReason ?? "理由なし"}`,
      );
      providerError.attemptMetadata = attemptMetadata;
      throw providerError;
    }
    const normalized = extractText(payload);
    return {
      text: normalized.text,
      metadata: {
        provider: this.providerId,
        transport: "ai_gateway" as const,
        adapterVersion: ADAPTER_VERSION,
        requestedModel: this.model,
        resolvedModel: this.model,
        providerRequestId: normalized.requestId ?? providerRequestId,
        inputTokens: token(normalized.usage, "input_tokens"),
        outputTokens: token(normalized.usage, "output_tokens"),
        latencyMs: Date.now() - started,
        finishReason: normalized.finishReason,
        dataRetentionMode: "no_retention" as const,
        citations: normalized.citations,
        effectiveSettings: {
          maxOutputTokens: request.maxOutputTokens,
          serviceTier: OPENAI_SERVICE_TIER,
          webSearch: request.enableWebSearch === true,
          safetyIdentifier: request.safetyIdentifier ?? null,
        },
        ignoredParameters: ["temperature"],
        providerResponseDiagnostics: diagnostics,
      },
    };
  }
}

class DeterministicProvider implements LlmProvider {
  constructor(readonly providerId: "replay" | "fake") {}
  async generateStructured<T>(request: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>> {
    const started = Date.now();
    const value = request.schema.parse(await request.fakeFactory());
    const metadata: LlmRunMetadata = {
      provider: this.providerId,
      transport: this.providerId,
      adapterVersion: ADAPTER_VERSION,
      requestedModel: `${this.providerId}-v1`,
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
      },
      ignoredParameters: [],
    };
    return {
      value,
      metadata,
      attempts: [{ output: value, metadata }],
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
      try {
        const result = await this.fallback.generateStructured({
          ...request,
          idempotencyKey: `${request.idempotencyKey}:fallback`,
        });
        const fallbackAttempts = (result.attempts ?? [{ output: result.value, metadata: result.metadata }]).map(
          (attempt) => ({
            ...attempt,
            metadata: {
              ...attempt.metadata,
              fallbackFromProvider: this.primary.providerId,
              fallbackErrorCode: error.code,
            },
          }),
        );
        return {
          ...result,
          attempts: [...error.attempts, ...fallbackAttempts],
          fallbackFrom: `${this.primary.providerId}:${error.code}`,
        };
      } catch (fallbackError) {
        if (fallbackError instanceof LlmProviderError) {
          fallbackError.attempts = [...error.attempts, ...fallbackError.attempts];
        }
        throw fallbackError;
      }
    }
  }
}

export function createLlmProvider(env: Env): LlmProvider {
  return new LlmProviderRouter(env);
}
