import { sha256Hex } from "../lib/crypto";
import { parseJson } from "./response";
import {
  type LlmMessage,
  type LlmProvider,
  LlmProviderError,
  type LlmProviderId,
  type LlmRunMetadata,
  type StructuredLlmRequest,
  type StructuredLlmResult,
} from "./types";

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

export abstract class RemoteProvider implements LlmProvider {
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
