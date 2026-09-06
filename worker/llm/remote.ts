import type { z } from "zod";
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
  type StructuredRepair,
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
    let repair: StructuredRepair | null = null;
    const attempts: Array<{ output: unknown; metadata: LlmRunMetadata }> = [];
    const rootRequestId = request.idempotencyKey;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const suffix = attempt === 0 ? ":attempt-0" : ":repair-1";
      const promptHash = await sha256Hex(JSON.stringify(messages));
      const activeRequest = repair ? { ...request, ...repair, fakeFactory: () => ({}) } : request;
      const schemaHash = await sha256Hex(JSON.stringify(activeRequest.jsonSchema));
      let response: { text: string; metadata: LlmRunMetadata };
      try {
        response = await this.invoke(activeRequest, messages, `${rootRequestId}${suffix}`);
      } catch (error) {
        if (error instanceof LlmProviderError) {
          if (error.attemptMetadata) {
            error.attemptMetadata = {
              ...error.attemptMetadata,
              rootRequestId,
              attemptNumber: attempt,
              promptHash,
              effectiveSettings: {
                ...error.attemptMetadata.effectiveSettings,
                actualSchemaName: activeRequest.schemaName,
                actualSchemaVersion: activeRequest.schemaVersion,
                actualSchemaHash: error.attemptMetadata.effectiveSettings?.actualSchemaHash ?? schemaHash,
                repairKind: attempt === 0 ? null : repair ? "understanding_assessments" : "full_json",
              },
            };
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
        effectiveSettings: {
          ...response.metadata.effectiveSettings,
          actualSchemaName: activeRequest.schemaName,
          actualSchemaVersion: activeRequest.schemaVersion,
          actualSchemaHash: response.metadata.effectiveSettings?.actualSchemaHash ?? schemaHash,
          repairKind: attempt === 0 ? null : repair ? "understanding_assessments" : "full_json",
        },
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
      const currentRepair = repair as StructuredRepair | null;
      const repairParsed: z.ZodSafeParseResult<unknown> | undefined = currentRepair?.schema.safeParse(raw);
      const parsed: z.ZodSafeParseResult<unknown> =
        repairParsed && !repairParsed.success
          ? repairParsed
          : request.schema.safeParse(
              currentRepair && repairParsed?.success ? currentRepair.merge(repairParsed.data) : raw,
            );
      if (parsed.success) return { value: parsed.data as T, metadata, attempts };
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
      repair = request.repairStrategy?.(raw, parsed.error.issues) ?? null;
      messages =
        repair?.messages ??
        repairMessages(
          messages,
          response.text,
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
        );
    }
    throw new LlmProviderError("構造化出力に失敗しました", "LLM_SCHEMA_INVALID", false);
  }
}
