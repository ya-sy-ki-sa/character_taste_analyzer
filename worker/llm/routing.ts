import { z } from "zod";
import { type MembershipTier, membershipTierSchema } from "../../shared/membership";
import type { Env } from "../types";
import { type LlmOperation, LlmProviderError } from "./types";

export const llmReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type LlmReasoningEffort = z.infer<typeof llmReasoningEffortSchema>;

const routeSchema = z
  .strictObject({
    provider: z.enum(["openai", "workers_ai", "replay", "fake"]),
    model: z.string().trim().min(1),
    effort: llmReasoningEffortSchema.nullable(),
  })
  .refine(
    (route) =>
      route.effort === null ||
      route.provider !== "workers_ai" ||
      (["@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b"].includes(route.model) &&
        ["low", "medium", "high"].includes(route.effort)),
    { message: "このWorkers AIモデルでは指定したeffortを利用できません", path: ["effort"] },
  );
export type LlmRoute = z.infer<typeof routeSchema>;
const configuredRouteSchema = z
  .strictObject({
    provider: z.enum(["openai", "workers_ai", "replay", "fake"]),
    model: z.string().trim().min(1),
    effort: llmReasoningEffortSchema.optional(),
  })
  .transform((route) => ({ ...route, effort: route.effort ?? null }))
  .pipe(routeSchema);
const tierRoutesSchema = z.strictObject({
  basic: configuredRouteSchema.optional(),
  silver: configuredRouteSchema.optional(),
  gold: configuredRouteSchema.optional(),
  premium: configuredRouteSchema.optional(),
});
const routePolicySchema = z.strictObject({ primary: routeSchema, fallback: routeSchema.nullable() });
export const llmRoutingSnapshotSchema = z.strictObject({
  policyVersion: z.literal("membership-v2"),
  membershipTier: membershipTierSchema,
  common: routePolicySchema,
  tier: routePolicySchema,
});
export type LlmRoutingSnapshot = z.infer<typeof llmRoutingSnapshotSchema>;
export type LlmExecutionContext = { snapshot: LlmRoutingSnapshot; jobId?: string };

// A new operation must explicitly choose its routing policy.
export const llmOperationRouting = {
  character_understanding: "tier",
  understanding_audit: "tier",
  customization_delta: "tier",
  preference_analysis: "tier",
  preference_audit: "tier",
  preference_hypotheses: "tier",
  generation_comparison: "tier",
  dark_scope_assessment: "common",
  dark_baseline_understanding: "tier",
  dark_character_understanding: "tier",
  dark_understanding_audit: "tier",
  dark_preference_analysis: "tier",
  dark_preference_audit: "tier",
  dark_character_generation: "tier",
  character_generation: "tier",
  generation_validation: "tier",
  generation_repair: "tier",
  schema_repair: "inherit",
} as const satisfies Record<LlmOperation, "tier" | "common" | "inherit">;

export function parseTierRoutes(value: string | undefined) {
  try {
    return tierRoutesSchema.parse(value === undefined ? {} : JSON.parse(value));
  } catch {
    throw new LlmProviderError("ティア別モデル設定が不正です", "LLM_TIER_ROUTES_INVALID", false);
  }
}

export function parseCommonLlmRoutes(env: Env) {
  try {
    const primary = configuredRouteSchema.parse({
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      effort: env.LLM_REASONING_EFFORT?.trim() || undefined,
    });
    const fallbackEffort = env.LLM_FALLBACK_REASONING_EFFORT?.trim() || undefined;
    const fallback =
      env.LLM_FALLBACK_PROVIDER || env.LLM_FALLBACK_MODEL || fallbackEffort
        ? configuredRouteSchema.parse({
            provider: env.LLM_FALLBACK_PROVIDER,
            model: env.LLM_FALLBACK_MODEL,
            effort: fallbackEffort,
          })
        : null;
    return { primary, fallback };
  } catch {
    throw new LlmProviderError("共通・フォールバックのモデルまたはeffort設定が不正です", "LLM_ROUTES_INVALID", false);
  }
}

export function resolveLlmRoutingSnapshot(env: Env, membershipTier: MembershipTier): LlmRoutingSnapshot {
  const { primary, fallback } = parseCommonLlmRoutes(env);
  const distinctFallback = (route: LlmRoute) =>
    fallback && (fallback.provider !== route.provider || fallback.model !== route.model) ? fallback : null;
  const tierPrimary = parseTierRoutes(env.LLM_TIER_ROUTES_JSON)[membershipTier] ?? primary;
  return {
    policyVersion: "membership-v2",
    membershipTier,
    common: { primary, fallback: distinctFallback(primary) },
    tier: { primary: tierPrimary, fallback: membershipTier === "basic" ? distinctFallback(tierPrimary) : null },
  };
}

export function selectLlmRoute(
  snapshot: LlmRoutingSnapshot,
  operation: LlmOperation,
  repairOfOperation?: Exclude<LlmOperation, "schema_repair">,
) {
  const effectiveOperation = operation === "schema_repair" ? repairOfOperation : operation;
  if (!effectiveOperation)
    throw new LlmProviderError("形式修復の元処理がありません", "LLM_REPAIR_ORIGIN_REQUIRED", false);
  const selectionReason = llmOperationRouting[effectiveOperation];
  return { ...snapshot[selectionReason], selectionReason, effectiveOperation };
}
