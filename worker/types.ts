export type WorkflowBinding<T> = {
  create(options: { id: string; params: T }): Promise<{ id: string }>;
};

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type CharacterAnalysisWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  entryId: string;
  stage: "understanding" | "preference";
};

export type GenerationWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  generationRequestId: string;
};

export type Env = {
  DB: D1Database;
  AI?: AiBinding;
  CHARACTER_ANALYSIS_WORKFLOW?: WorkflowBinding<CharacterAnalysisWorkflowParams>;
  GENERATION_WORKFLOW?: WorkflowBinding<GenerationWorkflowParams>;
  ASSETS?: Fetcher;
  ENVIRONMENT: "local" | "preview" | "production";
  DEPLOYMENT_PROFILE: "free_validation" | "cloudflare_paid" | "external_scale";
  DATASTORE_STRATEGY?: string;
  APP_ORIGIN?: string;
  AUTH_PEPPER: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  LLM_PROVIDER: "openai" | "workers_ai" | "replay" | "fake";
  LLM_MODEL: string;
  LLM_FALLBACK_PROVIDER?: "openai" | "workers_ai" | "replay" | "fake" | "";
  LLM_FALLBACK_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSPORT?: "direct" | "ai_gateway";
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_GATEWAY_ID?: string;
  EMBEDDING_PROVIDER: "openai" | "workers_ai" | "fake";
  EMBEDDING_MODEL: string;
  ANALYSIS_DAILY_QUOTA: string;
  GENERATION_DAILY_QUOTA: string;
  SESSION_DAYS: string;
  SESSION_RENEWAL_DAYS?: string;
  PUBLIC_WRITE_LIMIT_10_MIN?: string;
  USER_WRITE_LIMIT_PER_MIN?: string;
  IP_WRITE_LIMIT_PER_MIN?: string;
};

export type Session = {
  id: string;
  userId: string;
  username: string;
  csrfToken: string;
  expiresAt: string;
  credentialGeneration: number;
};

export type AppVariables = {
  requestId: string;
  session?: Session;
};
