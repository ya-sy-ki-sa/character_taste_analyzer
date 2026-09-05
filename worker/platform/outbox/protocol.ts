import type { OutboxPayload } from "./write";

export function workflowInstanceIdForEvent(eventId: string, type: OutboxPayload["type"]): string {
  const prefix =
    type === "analysis.start"
      ? "analysis"
      : type === "generation.start"
        ? "generation"
        : type === "profile.rebuild"
          ? "profile"
          : "export";
  return `${prefix}-${eventId}`;
}
