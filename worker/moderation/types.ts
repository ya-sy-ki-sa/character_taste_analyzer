export type ModerationInput = {
  field: string;
  text: string;
};

export type ModerationReason = {
  field: string;
  category: string;
  label: string;
};

export type ModerationResult = { allowed: true; reasons: [] } | { allowed: false; reasons: ModerationReason[] };

/** Provider-neutral contract for replacing the moderation backend. */
export interface ModerationProvider {
  readonly providerId: string;
  moderate(inputs: ModerationInput[]): Promise<ModerationResult>;
}

export class ModerationProviderError extends Error {
  constructor(
    message: string,
    readonly code: "MODERATION_CONFIGURATION_INVALID" | "MODERATION_PROVIDER_UNAVAILABLE",
  ) {
    super(message);
  }
}
