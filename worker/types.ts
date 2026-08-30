export type WorkflowBinding<T> = {
  create(options: { id: string; params: T }): Promise<{ id: string }>;
  get(id: string): Promise<{ id: string }>;
};

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type CharacterAnalysisWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  entryId: string;
  stage: "understanding" | "preference";
  inputGeneration: number;
};

export type GenerationWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  generationRequestId: string;
  inputGeneration: number;
};

export type ProfileRebuildWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  desiredGeneration: number;
};

export type ExportWorkflowParams = {
  jobId: string;
  ownerUserId: string;
  exportId: string;
};

export type Env = {
  DB: D1Database;
  AI?: AiBinding;
  CHARACTER_ANALYSIS_WORKFLOW?: WorkflowBinding<CharacterAnalysisWorkflowParams>;
  GENERATION_WORKFLOW?: WorkflowBinding<GenerationWorkflowParams>;
  PROFILE_REBUILD_WORKFLOW?: WorkflowBinding<ProfileRebuildWorkflowParams>;
  ACCOUNT_EXPORT_WORKFLOW?: WorkflowBinding<ExportWorkflowParams>;
  EXPORTS?: R2Bucket;
  ASSETS?: Fetcher;
  ENVIRONMENT: "local" | "preview" | "production";
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
  EMBEDDING_DIMENSIONS?: string;
  ANALYSIS_DAILY_QUOTA: string;
  GENERATION_DAILY_QUOTA: string;
  EXPORT_DAILY_QUOTA?: string;
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
};

export type AppVariables = {
  requestId: string;
  session?: Session;
};
