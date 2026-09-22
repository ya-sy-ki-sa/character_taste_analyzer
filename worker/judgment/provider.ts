import { sha256Hex } from "../lib/crypto";
import type { Env } from "../types";
import { CHOICE_CONFIDENCE, JUDGMENT_POLICY_VERSION, NOUL_NO, NOUL_YES } from "./policy";
import { type JudgmentProvider, JudgmentProviderError, type JudgmentRequest, type JudgmentResult } from "./types";
import { fixtureResult, parseJudgmentResult, validateQuestions } from "./validation";

const DEFAULT_JEV_MODEL = "typesafe/jev";
const TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

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
  env: Pick<Env, "JEV_PROVIDER" | "JEV_MODEL" | "AI" | "AI_GATEWAY_GATEWAY_ID">,
): string[] {
  const errors: string[] = [];
  if (!["typesafe", "fake", "replay"].includes(env.JEV_PROVIDER ?? ""))
    errors.push("JEV_PROVIDER_CONFIGURATION_INVALID");
  if (!env.JEV_MODEL?.trim()) errors.push("JEV_MODEL_REQUIRED");
  if (env.JEV_PROVIDER === "typesafe") {
    if (env.JEV_MODEL?.trim() && env.JEV_MODEL.trim() !== DEFAULT_JEV_MODEL) errors.push("JEV_MODEL_INVALID");
    if (!env.AI) errors.push("AI_BINDING_MISSING_FOR_JEV");
    if (!env.AI_GATEWAY_GATEWAY_ID?.trim()) errors.push("AI_GATEWAY_GATEWAY_ID_REQUIRED_FOR_JEV");
  }
  return errors;
}

async function emit(
  request: JudgmentRequest,
  provider: string,
  elapsed: number,
  result?: JudgmentResult,
  reason?: string,
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
  ) {}

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
        if (item.model !== this.model) throw new JudgmentProviderError("model_mismatch", false);
        Object.assign(result.answers, item.answers);
        result.usage.input_tokens += item.usage.input_tokens;
        result.usage.output_tokens += item.usage.output_tokens;
      }
      if (failure) {
        // Account for completed batches even if a sibling failed. No partial answers are returned.
        await emit(request, this.providerId, Date.now() - started, result, "batch_incomplete");
        throw failure;
      }
      await emit(request, this.providerId, Date.now() - started, result);
      return result;
    } catch (error) {
      await emit(
        request,
        this.providerId,
        Date.now() - started,
        undefined,
        error instanceof JudgmentProviderError ? error.reason : "invalid_request",
      );
      throw error instanceof JudgmentProviderError ? error : new JudgmentProviderError("invalid_request", false);
    }
  }

  private async call(state: unknown, questions: JudgmentRequest["questions"]): Promise<JudgmentResult> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const raw = await withTimeout(
          this.ai.run(this.model, { state, questions }, { gateway: { id: this.gatewayId } }),
          TIMEOUT_MS,
        );
        return parseJudgmentResult(raw, questions);
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
            ? error.status
            : undefined;
        const message = error instanceof Error ? error.message : String(error);
        const authenticationFailure = /401|403|unauthorized|forbidden/iu.test(message);
        const retryable =
          error instanceof JudgmentProviderError
            ? error.retryable
            : !authenticationFailure &&
              (status === undefined ||
                status === 429 ||
                (status !== undefined && status >= 500) ||
                /429|5\d\d|timeout|network|fetch/iu.test(message));
        if (!retryable || attempt === 2) {
          if (error instanceof JudgmentProviderError) throw error;
          throw new JudgmentProviderError(
            status === 429 ? "http_429" : status !== undefined && status >= 500 ? `http_${status}` : "network_error",
            retryable,
            status === 429 ? "PROVIDER_CAPACITY_EXHAUSTED" : undefined,
          );
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw new JudgmentProviderError("retry_exhausted", true);
  }
}

export function createJudgmentProvider(env: Env): JudgmentProvider {
  if (validateJudgmentConfig(env).length) throw new JudgmentProviderError("missing_configuration", false);
  if (env.JEV_PROVIDER === "fake") return new FakeJudgmentProvider();
  if (env.JEV_PROVIDER === "replay") return new ReplayJudgmentProvider();
  const ai = env.AI;
  const gatewayId = env.AI_GATEWAY_GATEWAY_ID;
  if (!ai || !gatewayId) throw new JudgmentProviderError("missing_configuration", false);
  return new CloudflareJevJudgmentProvider(ai, env.JEV_MODEL ?? DEFAULT_JEV_MODEL, gatewayId);
}
