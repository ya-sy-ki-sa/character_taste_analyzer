import { z } from "zod";
import { sessionUserSchema } from "../membership";

export const meResponseSchema = z
  .object({ user: sessionUserSchema, csrfToken: z.string(), expiresAt: z.string() })
  .meta({ id: "MeResponse" });
export type MeResponse = z.infer<typeof meResponseSchema>;
