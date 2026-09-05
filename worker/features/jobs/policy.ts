export type JobClaimDisposition = "claimable" | "superseded" | "already_finished" | "not_claimable";

const FINISHED_STATUSES = new Set(["succeeded", "waiting_for_user", "cancelled", "superseded"]);

export function jobClaimDisposition(input: {
  status: string;
  storedGeneration: number;
  requestedGeneration: number;
  targetType: string;
  activeRevisionNumber: number | null;
}): JobClaimDisposition {
  if (FINISHED_STATUSES.has(input.status)) return "already_finished";
  if (!["queued", "retrying", "failed"].includes(input.status)) return "not_claimable";
  if (input.storedGeneration !== input.requestedGeneration) return "superseded";
  if (
    input.targetType === "entry" &&
    input.activeRevisionNumber !== null &&
    input.activeRevisionNumber !== input.requestedGeneration
  ) {
    return "superseded";
  }
  return "claimable";
}

export function isRetryableFailure(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  const code = error instanceof Error ? error.message : "";
  return code.startsWith("D1_") || code === "PREFERENCE_ANALYSIS_EMPTY";
}
