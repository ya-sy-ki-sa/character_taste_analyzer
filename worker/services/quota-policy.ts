import { boundedInteger } from "../lib/numbers";

export type QuotaCapability = "analysis" | "generation" | "export";

export function quotaLimit(
  capability: QuotaCapability,
  configured: { analysis?: string; generation?: string; export?: string },
): number {
  if (capability === "analysis") return boundedInteger(configured.analysis, 30);
  if (capability === "generation") return boundedInteger(configured.generation, 10);
  return boundedInteger(configured.export, 3);
}

export function nextQuotaSlot(used: number, limit: number): number | null {
  const slot = Math.max(0, Math.trunc(used)) + 1;
  return slot <= limit ? slot : null;
}
