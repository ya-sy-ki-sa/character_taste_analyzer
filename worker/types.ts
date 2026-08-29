import type { TasteProfile } from "../shared/schemas";

export type WorkflowInstance = { id: string };
export type WorkflowBinding<T> = {
  create(options: { id: string; params: T }): Promise<WorkflowInstance>;
};

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type VectorizeBinding = {
  upsert(
    vectors: Array<{ id: string; values: number[]; namespace?: string; metadata?: Record<string, string> }>,
  ): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(
    vector: number[],
    options?: { topK?: number; namespace?: string; returnMetadata?: boolean },
  ): Promise<{
    matches?: Array<{ id: string; score: number; metadata?: Record<string, string> }>;
  }>;
};

export type AnalysisWorkflowParams = {
  jobId: string;
  userId: string;
  entryId: string;
  entryRevisionId: string;
  profileGeneration: number;
};

export type GenerationWorkflowParams = {
  jobId: string;
  userId: string;
  generationId: string;
};

export type Env = {
  DB: D1Database;
  AI?: AiBinding;
  VECTORS?: VectorizeBinding;
  ANALYSIS_WORKFLOW?: WorkflowBinding<AnalysisWorkflowParams>;
  GENERATION_WORKFLOW?: WorkflowBinding<GenerationWorkflowParams>;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  APP_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL: string;
  WORKERS_AI_MODEL: string;
  EMBEDDING_MODEL: string;
  AUTH_PEPPER: string;
  TURNSTILE_SECRET?: string;
  ALLOW_LOCAL_AI_FALLBACK: string;
  USE_REMOTE_AI_IN_DEV?: string;
  ANALYSIS_DAILY_QUOTA: string;
  GENERATION_DAILY_QUOTA: string;
  SESSION_DAYS: string;
  SESSION_RENEWAL_DAYS?: string;
  PUBLIC_WRITE_LIMIT_10_MIN?: string;
  USER_WRITE_LIMIT_PER_MIN?: string;
  IP_WRITE_LIMIT_PER_MIN?: string;
};

export type Session = {
  userId: string;
  username: string;
  csrfToken: string;
  expiresAt: string;
};

export type AppVariables = {
  requestId: string;
  session?: Session;
};

export type EntryRevisionRow = {
  id: string;
  entry_id: string;
  user_id: string;
  revision: number;
  kind: "existing" | "original";
  work_title: string | null;
  character_name: string | null;
  medium_or_edition: string | null;
  overview: string;
  preference_rating: number | null;
  liked_aspects: string | null;
  disliked_aspects: string | null;
  input_hash: string;
  created_at: string;
};

export type ProfileSnapshotRow = {
  id: string;
  user_id: string;
  version: number;
  profile_generation: number;
  profile_json: string;
  created_at: string;
};

export type GenerationRow = {
  id: string;
  user_id: string;
  profile_snapshot_id: string;
  job_id: string | null;
  mode: "faithful" | "balanced" | "surprising";
  request_note: string | null;
  result_json: string | null;
  similarity_score: number | null;
  similarity_warning: string | null;
  status: "queued" | "succeeded" | "failed";
  created_at: string;
  updated_at: string;
};

export type CurrentProfile = {
  id: string;
  profile: TasteProfile;
};
