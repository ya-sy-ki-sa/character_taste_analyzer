import type { GeneratedCharacterCandidate } from "../../shared/schemas";

export type GenerationCoverageBrief = {
  preferenceSelections: Array<{
    profileSnapshotItemId: string;
    treatment: "required" | "include" | "explore" | "prohibit";
  }>;
};

export function jsonPointerExists(value: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/")) return false;
  let current: unknown = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(token) || Number(token) >= current.length) return false;
      current = current[Number(token)];
    } else if (current && typeof current === "object" && Object.hasOwn(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      return false;
    }
  }
  return true;
}

export function validateGenerationCoverage(
  brief: GenerationCoverageBrief,
  candidate: GeneratedCharacterCandidate,
): string[] {
  const violations: string[] = [];
  const expected = new Map(brief.preferenceSelections.map((item) => [item.profileSnapshotItemId, item]));
  const counts = new Map<string, number>();
  for (const coverage of candidate.briefCoverage) {
    counts.set(coverage.profileSnapshotItemId, (counts.get(coverage.profileSnapshotItemId) ?? 0) + 1);
    const selection = expected.get(coverage.profileSnapshotItemId);
    if (!selection) violations.push(`未知のcoverage: ${coverage.profileSnapshotItemId}`);
    else if (coverage.treatment !== selection.treatment)
      violations.push(`treatment不一致: ${coverage.profileSnapshotItemId}`);
    if (!coverage.outputPointers.length) violations.push(`Pointer欠落: ${coverage.profileSnapshotItemId}`);
    for (const pointer of coverage.outputPointers) {
      if (!jsonPointerExists(candidate, pointer))
        violations.push(`Pointer不正: ${coverage.profileSnapshotItemId}:${pointer}`);
    }
    if (selection?.treatment === "required" && coverage.status !== "satisfied")
      violations.push(`必須嗜好未達: ${coverage.profileSnapshotItemId}`);
    if (selection?.treatment === "prohibit" && coverage.status === "violated")
      violations.push(`禁止嗜好違反: ${coverage.profileSnapshotItemId}`);
  }
  for (const id of expected.keys()) {
    const count = counts.get(id) ?? 0;
    if (count !== 1) violations.push(`coverage exactly-once違反: ${id}:${count}`);
  }
  return [...new Set(violations)];
}
