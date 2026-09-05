import { z } from "zod";
import {
  darkResponseChannelSchema,
  responseChannelSchema,
  valueOrientationSchema,
  valueStanceSchema,
} from "./taxonomy";
import { optionalText, text } from "./validation";

export const batchReviewSchema = z.object({
  decision: z.enum(["confirm_all", "confirm_selected", "reject_selected"]),
  targetIds: z.array(z.string().uuid()).max(300).default([]),
  reasonText: optionalText(2_000),
});

export const preferenceReviewAssertionFields = {
  rawLabel: text(200),
  attributeStableKey: z
    .string()
    .regex(/^[a-z0-9_.-]+$/u)
    .max(150)
    .nullable()
    .default(null),
  polarity: z.enum(["positive", "negative", "mixed"]),
  responseChannel: z.union([responseChannelSchema, darkResponseChannelSchema]),
  strength: z.number().min(0).max(1),
};

export const preferenceReviewStanceFields = {
  targetRef: text(500),
  stance: valueStanceSchema,
  orientation: valueOrientationSchema,
};

export const preferenceReviewMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_preference"), ...preferenceReviewAssertionFields }),
  z.object({ action: z.literal("update_preference"), targetId: z.string().uuid(), ...preferenceReviewAssertionFields }),
  z.object({ action: z.literal("add_value_stance"), ...preferenceReviewStanceFields }),
  z.object({ action: z.literal("update_value_stance"), targetId: z.string().uuid(), ...preferenceReviewStanceFields }),
]);

export type PreferenceReviewMutation = z.infer<typeof preferenceReviewMutationSchema>;

export const preferenceReviewRequestSchema = z.union([batchReviewSchema, preferenceReviewMutationSchema]);

export const reviewDeltaFields = {
  operation: z.enum(["inherit", "add", "modify", "remove", "invert", "narrow_scope", "emphasize", "unspecified"]),
  beforeValue: z.string().trim().min(1).max(2_000).nullable(),
  afterValue: z.string().trim().min(1).max(2_000).nullable(),
  reasonText: z.string().trim().min(1).max(2_000).nullable().default(null),
};

export const understandingReviewMutationSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("add_assertion"),
      rawLabel: text(200),
      valueText: text(2_000),
      attributeStableKey: z
        .string()
        .regex(/^[a-z0-9_.-]+$/u)
        .max(150)
        .nullable()
        .default(null),
    }),
    z.object({
      action: z.literal("update_assertion"),
      targetId: z.string().uuid(),
      rawLabel: text(200),
      valueText: text(2_000),
      attributeStableKey: z
        .string()
        .regex(/^[a-z0-9_.-]+$/u)
        .max(150)
        .nullable()
        .default(null),
    }),
    z.object({ action: z.literal("delete_assertion"), targetId: z.string().uuid() }),
    z.object({ action: z.literal("add_delta"), ...reviewDeltaFields }),
    z.object({ action: z.literal("update_delta"), targetId: z.string().uuid(), ...reviewDeltaFields }),
    z.object({ action: z.literal("delete_delta"), targetId: z.string().uuid() }),
  ])
  .superRefine((input, context) => {
    if (input.action !== "add_delta" && input.action !== "update_delta") return;
    if (input.operation === "add" && (input.beforeValue !== null || input.afterValue === null))
      context.addIssue({ code: "custom", message: "追加には変更後の設定だけを入力してください" });
    if (input.operation === "remove" && (input.beforeValue === null || input.afterValue !== null))
      context.addIssue({ code: "custom", message: "削除には原典の設定だけを入力してください" });
    if (["modify", "invert"].includes(input.operation) && (input.beforeValue === null || input.afterValue === null))
      context.addIssue({ code: "custom", message: "変更・反転には原典と変更後の設定が必要です" });
    if (input.beforeValue === null && input.afterValue === null)
      context.addIssue({ code: "custom", message: "原典または変更後の設定を入力してください" });
  });

export type UnderstandingReviewMutation = z.infer<typeof understandingReviewMutationSchema>;

export const understandingReviewRequestSchema = z.union([batchReviewSchema, understandingReviewMutationSchema]);
