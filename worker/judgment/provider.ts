import { sha256Hex } from "../lib/crypto";
import type { Env } from "../types";
import { CHOICE_CONFIDENCE, JUDGMENT_POLICY_VERSION, NOUL_NO, NOUL_YES } from "./policy";
import {
  type JudgmentProvider,
  type JudgmentProviderContext,
  JudgmentProviderError,
  type JudgmentRequest,
  type JudgmentResult,
} from "./types";
import { fixtureResult, parseJudgmentResult, validateQuestions } from "./validation";

const DEFAULT_JEV_MODEL = "typesafe/jev";
const JEV_RESPONSE_MODEL_PATTERN = /^jev-\d+(?:\.\d+)+$/u;
const TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJevResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "model" in value && "answers" in value && "usage" in value;
}

function isCompatibleJevModel(requestedModel: string, responseModel: string): boolean {
  return (
    responseModel === requestedModel ||
    (requestedModel === DEFAULT_JEV_MODEL && JEV_RESPONSE_MODEL_PATTERN.test(responseModel))
  );
}

/** Cloudflare AI bindings return the model result inside a response envelope. */
export function unwrapJevResponse(raw: unknown): unknown {
  let current = raw;
  for (let depth = 0; depth < 3; depth++) {
    if (isJevResult(current)) return current;
    if (!isRecord(current) || !("result" in current)) return current;
    current = current.result;
  }
  return current;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JudgmentProviderError("timeout", true)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function validateJudgmentConfig(
  env: Partial<
    Pick<
      Env,
      | "ENVIRONMENT"
      | "JEV_PROVIDER"
      | "JEV_MODEL"
      | "AI"
      | "AI_GATEWAY_ACCOUNT_ID"
      | "AI_GATEWAY_GATEWAY_ID"
      | "AI_GATEWAY_TOKEN"
    >
  >,
): string[] {
  const errors: string[] = [];
  if (!["typesafe", "fake", "replay"].includes(env.JEV_PROVIDER ?? ""))
    errors.push("JEV_PROVIDER_CONFIGURATION_INVALID");
  if (!env.JEV_MODEL?.trim()) errors.push("JEV_MODEL_REQUIRED");
  if (env.JEV_PROVIDER === "typesafe") {
    if (env.JEV_MODEL?.trim() && env.JEV_MODEL.trim() !== DEFAULT_JEV_MODEL) errors.push("JEV_MODEL_INVALID");
    if (!env.AI && env.ENVIRONMENT !== "local") errors.push("AI_BINDING_MISSING_FOR_JEV");
    if (!env.AI && env.ENVIRONMENT === "local" && (!env.AI_GATEWAY_ACCOUNT_ID || !env.AI_GATEWAY_TOKEN))
      errors.push("JEV_REST_AUTH_MISSING");
    if (!env.AI_GATEWAY_GATEWAY_ID?.trim()) errors.push("AI_GATEWAY_GATEWAY_ID_REQUIRED_FOR_JEV");
  }
  return errors;
}

/** Local development uses the same Gateway without requiring a remote preview session. */
function localRestAi(env: Env): NonNullable<Env["AI"]> {
  return {
    async run(model, input, options) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.AI_GATEWAY_ACCOUNT_ID ?? "")}/ai/run`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
            "Content-Type": "application/json",
            "cf-aig-gateway-id": options.gateway.id,
            "cf-aig-skip-cache": "true",
          },
          body: JSON.stringify({ model, input }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) throw { status: response.status };
      return response.json();
    },
  };
}

async function emit(
  request: JudgmentRequest,
  provider: string,
  elapsed: number,
  result?: JudgmentResult,
  reason?: string,
  includeDecisions = false,
) {
  const counts = { yes: 0, no: 0, uncertain: 0, concentrated: 0 };
  for (const answer of Object.values(result?.answers ?? {})) {
    if (answer.type === "noul") {
      if (answer.noul >= NOUL_YES) counts.yes++;
      else if (answer.noul <= NOUL_NO) counts.no++;
      else counts.uncertain++;
    } else if (answer.confidence >= CHOICE_CONFIDENCE) counts.concentrated++;
    else counts.uncertain++;
  }
  console.info(
    JSON.stringify({
      event: reason ? "judgment_provider_error" : "judgment_completed",
      ...request.context,
      provider,
      policyVersion: JUDGMENT_POLICY_VERSION,
      questionHash: await sha256Hex(JSON.stringify(request.questions)),
      model: result?.model,
      questionCount: Object.keys(request.questions).length,
      judgments: counts,
      ...(includeDecisions && result
        ? {
            decisions: Object.entries(result.answers).map(([id, answer]) => ({
              id,
              type: answer.type,
              selected: answer.type === "choice" ? answer.choice : answer.type === "score" ? answer.score : answer.noul,
              ...(answer.type === "noul" ? {} : { confidence: answer.confidence, probabilities: answer.probabilities }),
            })),
          }
        : {}),
      usage: result?.usage,
      latencyMs: elapsed,
      reason,
    }),
  );
}

/** Explicit fixture-backed adapters. Missing fixtures never become successful judgments. */
export class FakeJudgmentProvider implements JudgmentProvider {
  readonly providerId: "fake" | "replay" = "fake";
  async evaluate(request: JudgmentRequest): Promise<JudgmentResult> {
    validateQuestions(request.questions);
    if (!request.fakeAnswers) throw new JudgmentProviderError("offline_fixture_missing", false);
    return fixtureResult(
      `${this.providerId}:${DEFAULT_JEV_MODEL}`,
      structuredClone(request.fakeAnswers),
      request.questions,
    );
  }
}
export class ReplayJudgmentProvider extends FakeJudgmentProvider {
  override readonly providerId = "replay";
  // Fixtures are supplied with the replayed candidate/source, not inferred from prompt wording.
}

export class CloudflareJevJudgmentProvider implements JudgmentProvider {
  readonly providerId = "typesafe";
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(
    private readonly ai: NonNullable<Env["AI"]>,
    private readonly model: string,
    private readonly gatewayId: string,
    private readonly diagnostics = false,
  ) {}

  private get providerContext(): JudgmentProviderContext {
    return { providerId: this.providerId, model: this.model };
  }

  private withProviderContext(error: unknown): JudgmentProviderError {
    if (error instanceof JudgmentProviderError) {
      if (error.context?.providerId === this.providerId && error.context.model === this.model) return error;
      return new JudgmentProviderError(error.reason, error.retryable, error.code, this.providerContext);
    }
    return new JudgmentProviderError("invalid_request", false, "EXTERNAL_PROVIDER_UNAVAILABLE", this.providerContext);
  }

  private async limited<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    try {
      return await run();
    } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  async evaluate(request: JudgmentRequest): Promise<JudgmentResult> {
    const started = Date.now();
    try {
      validateQuestions(request.questions);
      if (!Object.keys(request.questions).length)
        return { model: this.model, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
      // Bound payload bytes independently of the provider token limit; never truncate evidence.
      // Token-limit rejections remain explicit provider errors, not silent partial judgments.
      const stateBytes = size(request.state);
      const batches: Array<JudgmentRequest["questions"]> = [];
      let batch: JudgmentRequest["questions"] = {};
      let bytes = stateBytes;
      for (const [id, question] of Object.entries(request.questions)) {
        const questionBytes = size({ [id]: question });
        if (stateBytes + questionBytes > 90_000) throw new JudgmentProviderError("context_too_large", false);
        if (bytes + questionBytes > 180_000) {
          batches.push(batch);
          batch = {};
          bytes = stateBytes;
        }
        batch[id] = question;
        bytes += questionBytes;
      }
      if (Object.keys(batch).length) batches.push(batch);
      const settled = await Promise.allSettled(
        batches.map((questions) => this.limited(() => this.call(request.state, questions))),
      );
      const result: JudgmentResult = { model: this.model, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
      let failure: unknown;
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failure ??= outcome.reason;
          continue;
        }
        const item = outcome.value;
        if (!isCompatibleJevModel(this.model, item.model)) throw new JudgmentProviderError("model_mismatch", false);
        Object.assign(result.answers, item.answers);
        result.usage.input_tokens += item.usage.input_tokens;
        result.usage.output_tokens += item.usage.output_tokens;
      }
      if (failure) {
        // Account for completed batches even if a sibling failed. No partial answers are returned.
        await emit(request, this.providerId, Date.now() - started, result, "batch_incomplete", this.diagnostics);
        throw failure;
      }
      await emit(request, this.providerId, Date.now() - started, result, undefined, this.diagnostics);
      return result;
    } catch (error) {
      const providerError = this.withProviderContext(error);
      await emit(request, this.providerId, Date.now() - started, undefined, providerError.reason, this.diagnostics);
      throw providerError;
    }
  }

  private async call(state: unknown, questions: JudgmentRequest["questions"]): Promise<JudgmentResult> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const raw = await withTimeout(
          this.ai.run(this.model, { state, questions }, { gateway: { id: this.gatewayId } }),
          TIMEOUT_MS,
        );
        return parseJudgmentResult(unwrapJevResponse(raw), questions);
      } catch (error) {
        const providerError = error instanceof JudgmentProviderError ? this.withProviderContext(error) : undefined;
        const status =
          typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
            ? error.status
            : undefined;
        const message = error instanceof Error ? error.message : String(error);
        const authenticationFailure = /401|403|unauthorized|forbidden/iu.test(message);
        const retryable = providerError
          ? providerError.retryable
          : !authenticationFailure &&
            (status === undefined ||
              status === 429 ||
              (status !== undefined && status >= 500) ||
              /429|5\d\d|timeout|network|fetch/iu.test(message));
        if (!retryable || attempt === 2) {
          if (providerError) throw providerError;
          throw new JudgmentProviderError(
            status === 429 ? "http_429" : status !== undefined && status >= 500 ? `http_${status}` : "network_error",
            retryable,
            status === 429 ? "PROVIDER_CAPACITY_EXHAUSTED" : undefined,
            this.providerContext,
          );
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw new JudgmentProviderError("retry_exhausted", true, "EXTERNAL_PROVIDER_UNAVAILABLE", this.providerContext);
  }
}

export function createJudgmentProvider(env: Env): JudgmentProvider {
  if (validateJudgmentConfig(env).length) throw new JudgmentProviderError("missing_configuration", false);
  if (env.JEV_PROVIDER === "fake") return new FakeJudgmentProvider();
  if (env.JEV_PROVIDER === "replay") return new ReplayJudgmentProvider();
  const ai = env.AI ?? (env.ENVIRONMENT === "local" ? localRestAi(env) : undefined);
  const gatewayId = env.AI_GATEWAY_GATEWAY_ID;
  if (!ai || !gatewayId) throw new JudgmentProviderError("missing_configuration", false);
  return new CloudflareJevJudgmentProvider(
    ai,
    env.JEV_MODEL ?? DEFAULT_JEV_MODEL,
    gatewayId,
    env.ENVIRONMENT === "local",
  );
}
