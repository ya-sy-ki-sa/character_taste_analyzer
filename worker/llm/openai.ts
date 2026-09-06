import { sha256Hex } from "../lib/crypto";
import type { Env } from "../types";
import { ADAPTER_VERSION } from "./adapter-version";
import { RemoteProvider } from "./remote";
import { extractText, openAiResponseDiagnostics, token } from "./response";
import type { LlmReasoningEffort } from "./routing";
import { type LlmMessage, LlmProviderError, type LlmRunMetadata, type StructuredLlmRequest } from "./types";

const OPENAI_REQUEST_TIMEOUT_MS = 15 * 60_000;

function openAiServiceTier(env: Env): "flex" | undefined {
  return env.OPENAI_FLEX_ENABLED === "true" ? "flex" : undefined;
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

export class OpenAiLlmProvider extends RemoteProvider {
  readonly providerId = "openai" as const;
  constructor(
    private readonly env: Env,
    private readonly model: string,
    private readonly effort?: LlmReasoningEffort,
  ) {
    super();
  }

  private modelMetadata() {
    return {
      provider: this.providerId,
      transport: "ai_gateway" as const,
      adapterVersion: ADAPTER_VERSION,
      requestedModel: this.model,
      resolvedModel: this.model,
    };
  }

  private effectiveSettings<T>(request: StructuredLlmRequest<T>, serviceTier: "flex" | undefined) {
    return {
      maxOutputTokens: request.maxOutputTokens,
      serviceTier: serviceTier ?? "auto",
      reasoningEffort: this.effort ?? null,
      webSearch: request.enableWebSearch === true,
      safetyIdentifier: request.safetyIdentifier ?? null,
    };
  }

  private endpoint(): string {
    if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_GATEWAY_ID)
      throw new LlmProviderError("AI Gatewayの設定が足りません", "PROVIDER_CONFIGURATION_INVALID", false);
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(this.env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(this.env.AI_GATEWAY_GATEWAY_ID)}/openai/responses`;
  }

  private requestBody<T>(
    request: StructuredLlmRequest<T>,
    messages: LlmMessage[],
    serviceTier: "flex" | undefined,
  ): string {
    return JSON.stringify({
      model: this.model,
      ...(this.effort ? { reasoning: { effort: this.effort } } : {}),
      ...(serviceTier ? { service_tier: serviceTier } : {}),
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
    });
  }

  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[], idempotencyKey: string) {
    if (!this.env.OPENAI_API_KEY)
      throw new LlmProviderError("OpenAI API keyがありません", "EXTERNAL_PROVIDER_UNAVAILABLE", false);
    if (!this.env.AI_GATEWAY_TOKEN)
      throw new LlmProviderError("AI Gateway tokenがありません", "PROVIDER_CONFIGURATION_INVALID", false);
    const started = Date.now();
    const serviceTier = openAiServiceTier(this.env);
    const body = this.requestBody(request, messages, serviceTier);
    const effectiveSettings = {
      ...this.effectiveSettings(request, serviceTier),
      actualSchemaHash: await sha256Hex(JSON.stringify(JSON.parse(body).text.format.schema)),
    };
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
        body,
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
        ...this.modelMetadata(),
        latencyMs: Date.now() - started,
        dataRetentionMode: "no_retention",
        effectiveSettings,
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
        ...this.modelMetadata(),
        providerRequestId: diagnostics.requestId ?? diagnostics.responseId,
        inputTokens: token(normalizedUsage, "input_tokens"),
        outputTokens: token(normalizedUsage, "output_tokens"),
        latencyMs: Date.now() - started,
        dataRetentionMode: "no_retention",
        effectiveSettings,
        ignoredParameters: ["temperature"],
        providerResponseDiagnostics: diagnostics,
      };
      throw providerError;
    }
    const providerRequestId = diagnostics.requestId ?? diagnostics.responseId;
    const attemptMetadata: LlmRunMetadata = {
      ...this.modelMetadata(),
      providerRequestId,
      inputTokens: token(normalizedUsage, "input_tokens"),
      outputTokens: token(normalizedUsage, "output_tokens"),
      latencyMs: Date.now() - started,
      dataRetentionMode: "no_retention",
      effectiveSettings,
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
        ...this.modelMetadata(),
        providerRequestId: normalized.requestId ?? providerRequestId,
        inputTokens: token(normalized.usage, "input_tokens"),
        outputTokens: token(normalized.usage, "output_tokens"),
        latencyMs: Date.now() - started,
        finishReason: normalized.finishReason,
        dataRetentionMode: "no_retention" as const,
        citations: normalized.citations,
        effectiveSettings,
        ignoredParameters: ["temperature"],
        providerResponseDiagnostics: diagnostics,
      },
    };
  }
}
