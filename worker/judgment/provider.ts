import type { Env } from "../types";
import { type JudgmentProvider, JudgmentProviderError, type JudgmentRequest, type JudgmentResult } from "./types";
import { fixtureResult, parseJudgmentResult, validateQuestions } from "./validation";

const JEV_MODEL = "typesafe/jev";
const TIMEOUT_MS = 20_000;
const MAX_PAYLOAD_BYTES = 90_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject an error at every Cloudflare envelope layer before accepting Jev data. */
export function unwrapJevResponse(raw: unknown): unknown {
  let current = raw;
  for (let depth = 0; depth <= 3; depth++) {
    if (!isRecord(current)) throw new JudgmentProviderError("invalid_response", false);
    if (current.success === false || current.error || (Array.isArray(current.errors) && current.errors.length))
      throw new JudgmentProviderError("upstream_error", false);
    if ("model" in current && "answers" in current && "usage" in current) return current;
    if (!("result" in current)) break;
    current = current.result;
  }
  throw new JudgmentProviderError("invalid_response", false);
}

export function validateJudgmentConfig(env: Env): string[] {
  const errors: string[] = [];
  if (!env.JEV_PROVIDER || !["typesafe", "fake", "replay"].includes(env.JEV_PROVIDER))
    errors.push("JEV_PROVIDER_CONFIGURATION_INVALID");
  if (env.JEV_PROVIDER === "typesafe") {
    if (!env.AI_GATEWAY_GATEWAY_ID?.trim()) errors.push("AI_GATEWAY_GATEWAY_ID_REQUIRED_FOR_JEV");
    if (env.ENVIRONMENT === "local") {
      if (!env.AI && (!env.AI_GATEWAY_ACCOUNT_ID || !env.AI_GATEWAY_TOKEN)) errors.push("JEV_REST_AUTH_MISSING");
    } else if (!env.AI) errors.push("AI_BINDING_MISSING_FOR_JEV");
  }
  return errors;
}

async function localRestRun(env: Env, state: unknown, questions: JudgmentRequest["questions"]): Promise<unknown> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.AI_GATEWAY_ACCOUNT_ID ?? "")}/ai/run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
        "cf-aig-gateway-id": env.AI_GATEWAY_GATEWAY_ID ?? "",
        "cf-aig-skip-cache": "true",
      },
      body: JSON.stringify({ model: JEV_MODEL, input: { state, questions } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) throw { status: response.status };
  return response.json();
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JudgmentProviderError("timeout", true)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class OfflineJudgmentProvider implements JudgmentProvider {
  constructor(readonly providerId: "fake" | "replay") {}

  async evaluate(request: JudgmentRequest): Promise<JudgmentResult> {
    validateQuestions(request.questions);
    if (!request.fakeAnswers) throw new JudgmentProviderError("offline_fixture_missing", false);
    return fixtureResult(`${this.providerId}:${JEV_MODEL}`, structuredClone(request.fakeAnswers), request.questions);
  }
}

export class CloudflareJevJudgmentProvider implements JudgmentProvider {
  readonly providerId = "typesafe";
  private readonly context = { providerId: "typesafe" as const, model: JEV_MODEL };

  constructor(private readonly env: Env) {}

  async evaluate(request: JudgmentRequest): Promise<JudgmentResult> {
    try {
      validateQuestions(request.questions);
      if (!Object.keys(request.questions).length)
        return { model: JEV_MODEL, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
      if (
        new TextEncoder().encode(JSON.stringify({ state: request.state, questions: request.questions })).length >
        MAX_PAYLOAD_BYTES
      )
        throw new JudgmentProviderError("context_too_large", false);
      for (let attempt = 0; ; attempt++) {
        try {
          const raw = await withTimeout(
            this.env.AI
              ? this.env.AI.run(
                  JEV_MODEL,
                  { state: request.state, questions: request.questions },
                  { gateway: { id: this.env.AI_GATEWAY_GATEWAY_ID ?? "" } },
                )
              : localRestRun(this.env, request.state, request.questions),
          );
          const result = parseJudgmentResult(unwrapJevResponse(raw), request.questions);
          if (result.model !== JEV_MODEL && !/^jev-\d+(?:\.\d+)+$/u.test(result.model))
            throw new JudgmentProviderError("model_mismatch", false);
          return result;
        } catch (error) {
          const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined;
          const retryable =
            error instanceof JudgmentProviderError
              ? error.retryable
              : status === undefined || status === 429 || status >= 500;
          if (!retryable || attempt === 2) {
            if (error instanceof JudgmentProviderError) throw error;
            throw new JudgmentProviderError(
              status === 401 || status === 403
                ? "authentication_error"
                : status === 429
                  ? "http_429"
                  : status !== undefined
                    ? `http_${status}`
                    : "network_error",
              retryable,
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
      }
    } catch (error) {
      if (error instanceof JudgmentProviderError)
        throw new JudgmentProviderError(error.reason, error.retryable, error.code, this.context);
      throw new JudgmentProviderError("network_error", true, "EXTERNAL_PROVIDER_UNAVAILABLE", this.context);
    }
  }
}

export function createJudgmentProvider(env: Env): JudgmentProvider {
  if (validateJudgmentConfig(env).length) throw new JudgmentProviderError("missing_configuration", false);
  if (env.JEV_PROVIDER === "fake" || env.JEV_PROVIDER === "replay")
    return new OfflineJudgmentProvider(env.JEV_PROVIDER);
  return new CloudflareJevJudgmentProvider(env);
}
