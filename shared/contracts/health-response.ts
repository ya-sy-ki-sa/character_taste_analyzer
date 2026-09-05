import { z } from "zod";
export const liveResponseSchema = z.object({ status: z.literal("ok") }).meta({ id: "LiveResponse" });
export const readyResponseSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    environment: z.string(),
    llmProvider: z.string(),
    embeddingProvider: z.string(),
    embeddingModel: z.string(),
    embeddingDimensions: z.number().nullable(),
    checks: z.object({ database: z.boolean(), configuration: z.boolean(), embedding: z.boolean() }),
    errors: z.array(z.string()),
  })
  .meta({ id: "ReadyResponse" });
