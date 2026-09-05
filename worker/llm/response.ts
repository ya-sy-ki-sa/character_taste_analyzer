import { LlmProviderError, type LlmRunMetadata } from "./types";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function openAiResponseDiagnostics(
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

export function extractText(payload: unknown): {
  text: string;
  requestId?: string;
  usage?: Record<string, unknown>;
  finishReason?: string;
  citations?: Array<{ url: string; title: string }>;
} {
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const citations = new Map<string, { url: string; title: string }>();
  const texts: string[] = [];
  const record = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const source = value as Record<string, unknown>;
    if (typeof source.url === "string")
      citations.set(source.url, {
        url: source.url,
        title: typeof source.title === "string" ? source.title : source.url,
      });
  };
  if (Array.isArray(object.output)) {
    for (const value of object.output) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const action = item.action as Record<string, unknown> | undefined;
      if (item.type === "web_search_call" && Array.isArray(action?.sources)) action.sources.forEach(record);
      if (!Array.isArray(item.content)) continue;
      for (const value of item.content) {
        if (!value || typeof value !== "object") continue;
        const part = value as Record<string, unknown>;
        if (Array.isArray(part.annotations)) {
          for (const annotation of part.annotations) {
            if (annotation && typeof annotation === "object" && annotation.type === "url_citation") record(annotation);
          }
        }
        if (typeof part.text === "string") texts.push(part.text);
      }
    }
  }
  const common = {
    requestId: typeof object.id === "string" ? object.id : undefined,
    usage: object.usage as Record<string, unknown>,
    citations: [...citations.values()],
  };
  if (typeof object.response === "string") return { ...common, text: object.response };
  if (typeof object.output_text === "string") return { ...common, text: object.output_text };
  if (Array.isArray(object.choices)) {
    const choice = object.choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string")
      return {
        ...common,
        text: message.content,
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
      };
  }
  if (texts.length) return { ...common, text: texts.join("\n") };
  if (object.result && typeof object.result === "object") return extractText(object.result);
  if (payload && typeof payload === "object")
    return { text: JSON.stringify(payload), usage: object.usage as Record<string, unknown> };
  throw new LlmProviderError("モデル応答が空です", "EXTERNAL_PROVIDER_INVALID_RESPONSE", false);
}

export function parseJson(text: string): unknown {
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

export function token(usage: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof usage?.[key] === "number") return usage[key];
  return undefined;
}
