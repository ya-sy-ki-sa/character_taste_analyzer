import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../worker/embedding/types";
import { embedSimilarityDocuments, similarityTextChunks } from "../worker/features/generation/embedding";

describe("full settings embedding", () => {
  it("keeps the entire input and UTF-8 code points within a byte budget", () => {
    const text = "長い設定と😀".repeat(4000),
      chunks = similarityTextChunks(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 6000)).toBe(true);
    expect(similarityTextChunks("")).toEqual([]);
    expect(similarityTextChunks("1234  ", 4).join("")).toBe("1234  ");
    expect(() => similarityTextChunks("x", 2)).toThrow("INVALID_EMBEDDING_CHUNK_SIZE");
  });
  it("batches long settings and computes vectors using every chunk", async () => {
    const embed = vi.fn(async (documents: Array<{ id: string; text: string }>) =>
      documents.map((document) => ({
        documentId: document.id,
        model: "test",
        values: document.text.includes("Z") ? [0, 1] : [1, 0],
      })),
    );
    const provider = { providerId: "openai", model: "test", embed } as EmbeddingProvider;
    const result = await embedSimilarityDocuments(provider, [
      { id: "long", text: `${"A".repeat(6000 * 21)}Z` },
      { id: "short", text: "Z" },
    ]);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls.every(([documents]) => documents.length <= 20)).toBe(true);
    expect(result.get("long")?.[1]).toBeCloseTo(1 / 126001, 8);
    expect(result.get("short")).toEqual([0, 1]);
  });
  it("rejects missing and duplicate provider responses", async () => {
    const provider = { providerId: "openai", model: "test", embed: async () => [] } as EmbeddingProvider;
    await expect(embedSimilarityDocuments(provider, [{ id: "one", text: "内容" }])).rejects.toThrow(
      "EMBEDDING_RESPONSE_INCOMPLETE",
    );
    provider.embed = async () => [
      { documentId: "one#0", model: "test", values: [1] },
      { documentId: "one#0", model: "test", values: [1] },
    ];
    await expect(
      embedSimilarityDocuments(provider, [
        { id: "one", text: "内容" },
        { id: "two", text: "別の内容" },
      ]),
    ).rejects.toThrow("EMBEDDING_RESPONSE_INCOMPLETE");
  });
});
