import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingProvider } from "../worker/embedding/providers";
import type { Env } from "../worker/types";

function providerEnv(overrides: Partial<Env>): Env {
  return {
    LLM_PROVIDER: "fake",
    LLM_MODEL: "fake-v1",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    ENVIRONMENT: "local",
    DEPLOYMENT_PROFILE: "free_validation",
    AUTH_PEPPER: "test",
    ANALYSIS_DAILY_QUOTA: "100",
    GENERATION_DAILY_QUOTA: "100",
    SESSION_DAYS: "30",
    ...overrides,
  } as Env;
}

const documents = [
  { id: "document-1", text: "first text" },
  { id: "document-2", text: "second text" },
];

describe("embedding provider polymorphism", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the OpenAI Embeddings API contract and preserves document order", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "text-embedding-3-small",
        input: ["first text", "second text"],
        encoding_format: "float",
        dimensions: 3,
      });
      return Response.json({
        object: "list",
        model: "text-embedding-3-small",
        data: [
          { object: "embedding", index: 1, embedding: [0, 1, 0] },
          { object: "embedding", index: 0, embedding: [1, 0, 0] },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createEmbeddingProvider(
      providerEnv({
        EMBEDDING_PROVIDER: "openai",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_DIMENSIONS: "3",
        OPENAI_API_KEY: "test-key",
        OPENAI_TRANSPORT: "direct",
      }),
    );
    const vectors = await provider.embed(documents);

    expect(provider.providerId).toBe("openai");
    expect(provider.dimensions).toBe(3);
    expect(vectors).toEqual([
      { documentId: "document-1", values: [1, 0, 0], model: "text-embedding-3-small" },
      { documentId: "document-2", values: [0, 1, 0], model: "text-embedding-3-small" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes Workers AI through the same EmbeddingProvider port", async () => {
    const run = vi.fn(async () => ({
      shape: [2, 3],
      data: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    }));
    const provider = createEmbeddingProvider(
      providerEnv({
        EMBEDDING_PROVIDER: "workers_ai",
        EMBEDDING_MODEL: "workers-embedding-model",
        EMBEDDING_DIMENSIONS: "3",
        AI: { run },
      }),
    );

    const vectors = await provider.embed(documents);

    expect(provider.providerId).toBe("workers_ai");
    expect(run).toHaveBeenCalledWith("workers-embedding-model", { text: ["first text", "second text"] });
    expect(vectors.map((vector) => vector.documentId)).toEqual(["document-1", "document-2"]);
  });

  it("provides deterministic fake vectors with the configured dimensions", async () => {
    const provider = createEmbeddingProvider(
      providerEnv({ EMBEDDING_PROVIDER: "fake", EMBEDDING_MODEL: "fake-v1", EMBEDDING_DIMENSIONS: "4" }),
    );

    const first = await provider.embed([documents[0]]);
    const second = await provider.embed([documents[0]]);

    expect(first).toEqual(second);
    expect(first[0].values).toHaveLength(4);
  });

  it("rejects vectors whose dimensions do not match the deployment contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          object: "list",
          model: "text-embedding-3-small",
          data: [{ object: "embedding", index: 0, embedding: [1, 0] }],
        }),
      ),
    );
    const provider = createEmbeddingProvider(
      providerEnv({
        EMBEDDING_PROVIDER: "openai",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_DIMENSIONS: "3",
        OPENAI_API_KEY: "test-key",
      }),
    );

    await expect(provider.embed([documents[0]])).rejects.toMatchObject({
      code: "EMBEDDING_DIMENSION_MISMATCH",
      retryable: false,
    });
  });
});
