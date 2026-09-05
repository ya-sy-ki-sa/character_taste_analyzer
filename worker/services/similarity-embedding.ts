import type { EmbeddingProvider } from "../embedding/types";

/** Split by UTF-8 bytes without dropping settings or cutting a code point. */
export function similarityTextChunks(text: string, maxBytes = 6000): string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new Error("INVALID_EMBEDDING_CHUNK_SIZE");
  const encoder = new TextEncoder(),
    chunks: string[] = [];
  let current = "",
    bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}
export async function embedSimilarityDocuments(
  provider: EmbeddingProvider,
  documents: Array<{ id: string; text: string }>,
) {
  const parts = documents.flatMap((document) =>
    similarityTextChunks(document.text)
      .map((text, index) => ({
        id: `${document.id}#${index}`,
        documentId: document.id,
        text,
      }))
      .filter((part) => part.text.trim()),
  );
  const sums = new Map<string, { values: number[]; weight: number }>();
  for (let offset = 0; offset < parts.length; offset += 20) {
    const batch = parts.slice(offset, offset + 20),
      vectors = await provider.embed(batch);
    if (vectors.length !== batch.length || new Set(vectors.map((item) => item.documentId)).size !== batch.length)
      throw new Error("EMBEDDING_RESPONSE_INCOMPLETE");
    for (const part of batch) {
      const vector = vectors.find((item) => item.documentId === part.id);
      if (!vector?.values.length) throw new Error("EMBEDDING_RESPONSE_INCOMPLETE");
      const sum = sums.get(part.documentId) ?? { values: vector.values.map(() => 0), weight: 0 };
      if (sum.values.length !== vector.values.length) throw new Error("EMBEDDING_DIMENSION_MISMATCH");
      const weight = new TextEncoder().encode(part.text).length;
      vector.values.forEach((value, index) => {
        sum.values[index] += value * weight;
      });
      sum.weight += weight;
      sums.set(part.documentId, sum);
    }
  }
  return new Map(
    documents.map((document) => {
      const sum = sums.get(document.id);
      if (!sum) throw new Error("EMBEDDING_INPUT_INVALID");
      return [document.id, sum.values.map((value) => value / sum.weight)];
    }),
  );
}
