import { z } from "zod";
export const apiErrorSchema = z
  .object({ code: z.string(), message: z.string(), requestId: z.string(), details: z.unknown().optional() })
  .meta({ id: "ApiError" });
export const apiErrorEnvelopeSchema = z.object({ error: apiErrorSchema }).meta({ id: "ApiErrorEnvelope" });
export type ApiError = z.infer<typeof apiErrorSchema>;
