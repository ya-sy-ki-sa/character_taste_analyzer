export type JudgmentQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JudgmentRequest = {
  state: unknown;
  questions: Record<string, JudgmentQuestion>;
  context: { correlationId: string; stage: string; domain: "standard" | "dark" };
  /** Offline fixtures are never sent to the remote provider. */
  fakeAnswers?: Record<string, ChoiceAnswer>;
};

export type JudgmentResult = {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

export type JudgmentProviderId = "typesafe" | "fake" | "replay";
export type JudgmentProviderContext = { providerId: JudgmentProviderId; model: string };

export interface JudgmentProvider {
  readonly providerId: JudgmentProviderId;
  evaluate(request: JudgmentRequest): Promise<JudgmentResult>;
}

export class JudgmentProviderError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
    readonly code = "EXTERNAL_PROVIDER_UNAVAILABLE",
    readonly context?: JudgmentProviderContext,
  ) {
    super(code);
  }
}
