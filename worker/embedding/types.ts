export type EmbeddingProviderId = "openai" | "workers_ai" | "fake";

export type EmbeddingDocument = {
  id: string;
  text: string;
};

export type EmbeddingVector = {
  documentId: string;
  values: number[];
  model: string;
};

export interface EmbeddingProvider {
  readonly providerId: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions?: number;
  embed(documents: EmbeddingDocument[]): Promise<EmbeddingVector[]>;
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly safeDetail?: string,
  ) {
    super(message);
  }
}
