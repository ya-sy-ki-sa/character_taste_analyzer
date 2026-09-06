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

export type ModerationDiagnostics = {
  reason: "missing_configuration" | "timeout" | "network_error" | "http_error" | "invalid_response";
  status?: number;
  missingBindings?: Array<"OPENAI_API_KEY" | "AI_GATEWAY_ACCOUNT_ID" | "AI_GATEWAY_GATEWAY_ID" | "AI_GATEWAY_TOKEN">;
};

export class ModerationProviderError extends Error {
  constructor(
    message: string,
    readonly code: "MODERATION_CONFIGURATION_INVALID" | "MODERATION_PROVIDER_UNAVAILABLE",
    readonly diagnostics?: ModerationDiagnostics,
  ) {
    super(message);
  }
}
