import { z } from "zod";

export const membershipTierSchema = z.enum(["basic", "silver", "gold", "premium"]);
export type MembershipTier = z.infer<typeof membershipTierSchema>;
export const membershipTierLabels: Record<MembershipTier, string> = {
  basic: "ベーシック",
  silver: "シルバー",
  gold: "ゴールド",
  premium: "プレミアム",
};

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  membershipTier: membershipTierSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
