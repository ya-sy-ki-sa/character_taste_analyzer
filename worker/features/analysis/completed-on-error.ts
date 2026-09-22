import type { CompletedLlmGroup } from "./types";

const completedGroupsByError = new WeakMap<object, CompletedLlmGroup[]>();

function attemptKey(group: CompletedLlmGroup, attempt: CompletedLlmGroup["attempts"][number]): string {
  return [
    group.operation,
    group.inputHash,
    attempt.metadata.rootRequestId ?? "",
    attempt.metadata.attemptNumber ?? 0,
    attempt.metadata.provider,
  ].join(":");
}

export function mergeCompletedLlmGroups(...collections: CompletedLlmGroup[][]): CompletedLlmGroup[] {
  const groups = new Map<string, CompletedLlmGroup>();
  const seenAttempts = new Set<string>();
  for (const collection of collections) {
    for (const group of collection) {
      const key = `${group.operation}\u0000${group.inputHash}`;
      const merged = groups.get(key) ?? { ...group, attempts: [] };
      for (const attempt of group.attempts) {
        const key = attemptKey(group, attempt);
        if (seenAttempts.has(key)) continue;
        seenAttempts.add(key);
        merged.attempts.push(attempt);
      }
      groups.set(key, merged);
    }
  }
  return [...groups.values()];
}

/** Associate completed provider calls with a later non-LLM failure without changing that failure's type. */
export function carryCompletedLlmGroups(error: unknown, groups: CompletedLlmGroup[]): void {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return;
  completedGroupsByError.set(error, mergeCompletedLlmGroups(completedGroupsByError.get(error) ?? [], groups));
}

export function completedLlmGroupsFromError(error: unknown): CompletedLlmGroup[] {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return [];
  return completedGroupsByError.get(error) ?? [];
}
