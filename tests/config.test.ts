import { describe, expect, it } from "vitest";
import { validateConfig } from "../worker/config";
import type { Env } from "../worker/types";

function localEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "local",
    AUTH_PEPPER: "test-pepper",
    LLM_PROVIDER: "replay",
    LLM_MODEL: "replay-v1",
    MODERATION_PROVIDER: "fake",
    MODERATION_MODEL: "fake-v1",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    EMBEDDING_DIMENSIONS: "1536",
    ANALYSIS_DAILY_QUOTA: "30",
    GENERATION_DAILY_QUOTA: "10",
    SESSION_DAYS: "30",
    ...overrides,
  };
}

describe("readiness configuration", () => {
  it("accepts the hermetic local providers", () => {
    expect(validateConfig(localEnv())).toEqual({ ready: true, errors: [] });
  });

  it("rejects incomplete or duplicate fallback configuration", () => {
    expect(validateConfig(localEnv({ LLM_FALLBACK_PROVIDER: "openai", LLM_FALLBACK_MODEL: "" })).errors).toContain(
      "LLM_FALLBACK_INCOMPLETE",
    );
    expect(
      validateConfig(localEnv({ LLM_FALLBACK_PROVIDER: "replay", LLM_FALLBACK_MODEL: "replay-v1" })).errors,
    ).toContain("LLM_FALLBACK_DUPLICATES_PRIMARY");
  });

  it("defaults OpenAI Flex to off and rejects invalid flag values", () => {
    expect(validateConfig(localEnv()).errors).not.toContain("OPENAI_FLEX_ENABLED_INVALID");
    expect(validateConfig(localEnv({ OPENAI_FLEX_ENABLED: "false" })).errors).not.toContain(
      "OPENAI_FLEX_ENABLED_INVALID",
    );
    expect(validateConfig(localEnv({ OPENAI_FLEX_ENABLED: "true" })).errors).not.toContain(
      "OPENAI_FLEX_ENABLED_INVALID",
    );
    expect(validateConfig(localEnv({ OPENAI_FLEX_ENABLED: "on" })).errors).toContain("OPENAI_FLEX_ENABLED_INVALID");
  });

  it("validates provider keys and embedding dimensions", () => {
    expect(
      validateConfig(
        localEnv({
          LLM_PROVIDER: "openai",
          LLM_MODEL: "gpt-5.6-luna",
          EMBEDDING_PROVIDER: "openai",
          EMBEDDING_MODEL: "text-embedding-3-small",
          EMBEDDING_DIMENSIONS: "1024",
        }),
      ).errors,
    ).toEqual(
      expect.arrayContaining([
        "OPENAI_API_KEY_MISSING",
        "AI_GATEWAY_GATEWAY_ID_MISSING",
        "AI_GATEWAY_ACCOUNT_ID_MISSING",
        "AI_GATEWAY_TOKEN_MISSING",
        "EMBEDDING_DIMENSIONS_MISMATCH",
      ]),
    );
  });

  it("requires non-local origins and operational bindings", () => {
    const result = validateConfig(
      localEnv({
        ENVIRONMENT: "preview",
        APP_ORIGIN: "",
        EMBEDDING_PROVIDER: "workers_ai",
        EMBEDDING_MODEL: "@cf/baai/bge-m3",
        EMBEDDING_DIMENSIONS: "1024",
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "AI_BINDING_MISSING",
        "AI_GATEWAY_GATEWAY_ID_MISSING",
        "APP_ORIGIN_MISSING",
        "EXPORTS_BINDING_MISSING",
        "ANALYSIS_WORKFLOW_BINDING_MISSING",
        "GENERATION_WORKFLOW_BINDING_MISSING",
        "PROFILE_WORKFLOW_BINDING_MISSING",
        "EXPORT_WORKFLOW_BINDING_MISSING",
      ]),
    );
  });
});
