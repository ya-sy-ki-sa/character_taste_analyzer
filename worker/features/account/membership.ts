import { type MembershipTier, membershipTierSchema } from "../../../shared/membership";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/membership";

/** The entitlement policy uses server-owned user data, never request input. */
export function membershipTierForUser(user: { membership_tier: unknown }): MembershipTier {
  return membershipTierSchema.parse(user.membership_tier);
}

export async function loadMembershipTier(env: Env, ownerUserId: string): Promise<MembershipTier> {
  const user = await first<{ membership_tier: string }>(repository.selectUsers(env.DB, [ownerUserId]));
  if (!user) throw new Error("MEMBERSHIP_USER_NOT_FOUND");
  return membershipTierForUser(user);
}
