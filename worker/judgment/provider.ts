import { sha256Hex } from "../lib/crypto";
import type { Env } from "../types";
import { CHOICE_CONFIDENCE, JUDGMENT_POLICY_VERSION, NOUL_NO, NOUL_YES } from "./policy";
import { type JudgmentProvider, JudgmentProviderError, type JudgmentRequest, type JudgmentResult } from "./types";
import { fixtureResult, parseJudgmentResult, validateQuestions } from "./validation";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

export function validateJudgmentConfig(env: Pick<Env, "JEV_PROVIDER" | "JEV_MODEL" | "TYPESAFE_API_KEY">): string[] {
  const errors: string[] = [];
  if (!["typesafe", "fake", "replay"].includes(env.JEV_PROVIDER ?? ""))
    errors.push("JEV_PROVIDER_CONFIGURATION_INVALID");
  if (!env.JEV_MODEL?.trim()) errors.push("JEV_MODEL_REQUIRED");
  if (env.JEV_PROVIDER === "typesafe" && !env.TYPESAFE_API_KEY?.trim()) errors.push("TYPESAFE_API_KEY_REQUIRED");
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
    return fixtureResult(`${this.providerId}:jev-1.13.0`, structuredClone(request.fakeAnswers), request.questions);
  }
}
export class ReplayJudgmentProvider extends FakeJudgmentProvider {
  override readonly providerId = "replay";
  // Fixtures are supplied with the replayed candidate/source, not inferred from prompt wording.
}

export class TypeSafeJudgmentProvider implements JudgmentProvider {
  readonly providerId = "typesafe";
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  private async limited<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      return await run();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let retryDelay = 500 * 2 ** attempt;
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, state, questions }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const retryable = response.status === 429 || response.status >= 500;
          const header = response.headers.get("retry-after");
          if (header) {
            const seconds = Number(header);
            const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
            if (Number.isFinite(milliseconds)) retryDelay = Math.max(retryDelay, milliseconds);
          }
          if (!retryable || attempt === 2 || retryDelay > TIMEOUT_MS)
            throw new JudgmentProviderError(
              `http_${response.status}`,
              retryable,
              response.status === 429 || response.status === 529 ? "PROVIDER_CAPACITY_EXHAUSTED" : undefined,
            );
        } else {
          if (!response.body) throw new JudgmentProviderError("empty_response", false);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let text = "";
          let bytes = 0;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new JudgmentProviderError("response_too_large", false);
              }
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            reader.releaseLock();
          }
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            throw new JudgmentProviderError("invalid_json", false);
          }
          return parseJudgmentResult(raw, questions);
        }
      } catch (error) {
        if (error instanceof JudgmentProviderError) throw error;
        if (attempt === 2)
          throw new JudgmentProviderError(controller.signal.aborted ? "timeout" : "network_error", true);
      } finally {
        clearTimeout(timeout);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
    }
    throw new JudgmentProviderError("retry_exhausted", true);
  }
}

export function createJudgmentProvider(env: Env): JudgmentProvider {
  if (validateJudgmentConfig(env).length) throw new JudgmentProviderError("missing_configuration", false);
  if (env.JEV_PROVIDER === "fake") return new FakeJudgmentProvider();
  if (env.JEV_PROVIDER === "replay") return new ReplayJudgmentProvider();
  return new TypeSafeJudgmentProvider(env.TYPESAFE_API_KEY ?? "", env.JEV_MODEL ?? "");
}
