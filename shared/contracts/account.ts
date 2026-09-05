import { z } from "zod";
import { text } from "./validation";

export const usernameSchema = text(32, "ユーザー名を入力してください");

export const registrationSchema = z.object({
  username: usernameSchema,
  turnstileToken: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const activationSchema = z.object({ accessKey: z.string().uuid() });

export const loginSchema = z.object({
  username: usernameSchema,
  accessKey: z.string().uuid(),
  turnstileToken: z.string().optional(),
});

export const accountDeletionSchema = z.object({ usernameConfirmation: usernameSchema });

export const accountExportRequestSchema = z.object({}).strict();
