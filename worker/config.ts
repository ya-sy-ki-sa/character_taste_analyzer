import type { Env } from "./types";

export type ConfigValidation = { ready: boolean; errors: string[] };

export function validateConfig(env: Env): ConfigValidation {
  const errors: string[] = [];
  if (!env.DB) errors.push("DB_BINDING_MISSING");
  if (!env.AUTH_PEPPER) errors.push("AUTH_PEPPER_MISSING");
  if (!env.LLM_PROVIDER || !env.LLM_MODEL) errors.push("LLM_PRIMARY_MISSING");
  if ((env.LLM_FALLBACK_PROVIDER && !env.LLM_FALLBACK_MODEL) || (!env.LLM_FALLBACK_PROVIDER && env.LLM_FALLBACK_MODEL))
    errors.push("LLM_FALLBACK_INCOMPLETE");
  if (
    env.LLM_FALLBACK_PROVIDER &&
    env.LLM_FALLBACK_PROVIDER === env.LLM_PROVIDER &&
    env.LLM_FALLBACK_MODEL === env.LLM_MODEL
  )
    errors.push("LLM_FALLBACK_DUPLICATES_PRIMARY");
  if (
    (env.LLM_PROVIDER === "openai" || env.LLM_FALLBACK_PROVIDER === "openai" || env.EMBEDDING_PROVIDER === "openai") &&
    !env.OPENAI_API_KEY
  )
    errors.push("OPENAI_API_KEY_MISSING");
  const usesOpenAi =
    env.LLM_PROVIDER === "openai" || env.LLM_FALLBACK_PROVIDER === "openai" || env.EMBEDDING_PROVIDER === "openai";
  const usesWorkersAi =
    env.LLM_PROVIDER === "workers_ai" ||
    env.LLM_FALLBACK_PROVIDER === "workers_ai" ||
    env.EMBEDDING_PROVIDER === "workers_ai";
  if ((usesOpenAi || usesWorkersAi) && !env.AI_GATEWAY_GATEWAY_ID) errors.push("AI_GATEWAY_GATEWAY_ID_MISSING");
  if (usesOpenAi && !env.AI_GATEWAY_ACCOUNT_ID) errors.push("AI_GATEWAY_ACCOUNT_ID_MISSING");
  if (usesOpenAi && !env.AI_GATEWAY_TOKEN) errors.push("AI_GATEWAY_TOKEN_MISSING");
  if (usesWorkersAi && !env.AI) errors.push("AI_BINDING_MISSING");
  if (env.ENVIRONMENT !== "local") {
    if (!env.APP_ORIGIN) errors.push("APP_ORIGIN_MISSING");
    else {
      try {
        new URL(env.APP_ORIGIN);
      } catch {
        errors.push("APP_ORIGIN_INVALID");
      }
    }
    if (!env.EXPORTS) errors.push("EXPORTS_BINDING_MISSING");
    if (!env.CHARACTER_ANALYSIS_WORKFLOW) errors.push("ANALYSIS_WORKFLOW_BINDING_MISSING");
    if (!env.GENERATION_WORKFLOW) errors.push("GENERATION_WORKFLOW_BINDING_MISSING");
    if (!env.PROFILE_REBUILD_WORKFLOW) errors.push("PROFILE_WORKFLOW_BINDING_MISSING");
    if (!env.ACCOUNT_EXPORT_WORKFLOW) errors.push("EXPORT_WORKFLOW_BINDING_MISSING");
    if (env.ENVIRONMENT === "production" && !env.TURNSTILE_SECRET) errors.push("TURNSTILE_SECRET_MISSING");
  }
  const dimensions = Number(env.EMBEDDING_DIMENSIONS);
  const expected =
    env.EMBEDDING_MODEL === "@cf/baai/bge-m3" ? 1024 : env.EMBEDDING_MODEL === "text-embedding-3-small" ? 1536 : null;
  if (!Number.isInteger(dimensions) || dimensions <= 0) errors.push("EMBEDDING_DIMENSIONS_INVALID");
  else if (expected !== null && dimensions !== expected) errors.push("EMBEDDING_DIMENSIONS_MISMATCH");
  return { ready: errors.length === 0, errors };
}
