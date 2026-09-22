export type JudgmentQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: number[];
  confidence: number;
};
export type JudgmentAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
export type JudgmentRequest = {
  state: unknown;
  questions: Record<string, JudgmentQuestion>;
  context: { correlationId: string; stage: string; domain?: "standard" | "dark" };
  /** Explicit offline fixtures only. Never serialized to the remote provider. */
  fakeAnswers?: Record<string, JudgmentAnswer>;
};
export type JudgmentResult = {
  answers: Record<string, JudgmentAnswer>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};
export type JudgmentProviderId = "typesafe" | "fake" | "replay";
export type JudgmentProviderContext = {
  providerId: JudgmentProviderId;
  model: string;
};
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
    // Existing job failure handlers persist Error.message. Keep it safe and compatible.
    super(code);
  }
}
