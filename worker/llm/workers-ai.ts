import type { Env } from "../types";
import { ADAPTER_VERSION } from "./adapter-version";
import { RemoteProvider } from "./remote";
import { extractText, token } from "./response";
import type { LlmReasoningEffort } from "./routing";
import { type LlmMessage, LlmProviderError, type StructuredLlmRequest } from "./types";

export class WorkersAiLlmProvider extends RemoteProvider {
  readonly providerId = "workers_ai" as const;
  constructor(
    private readonly env: Env,
    private readonly model: string,
    private readonly effort?: LlmReasoningEffort,
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
          ...(this.effort ? { reasoning_effort: this.effort } : {}),
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
        effectiveSettings: {
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          reasoningEffort: this.effort ?? null,
        },
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
        effectiveSettings: {
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          reasoningEffort: this.effort ?? null,
        },
        ignoredParameters: [],
      },
    };
  }
}
