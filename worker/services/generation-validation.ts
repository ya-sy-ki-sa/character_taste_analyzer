import type { AnyGeneratedCharacterCandidate } from "../../shared/schemas";

export type GenerationCoverageBrief = {
  briefId?: string;
  preferenceSelections: Array<{
    profileSnapshotItemId: string;
    treatment: "required" | "include" | "explore" | "prohibit";
  }>;
};

export function jsonPointerExists(value: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) return false;
  let current: unknown = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(token) || Number(token) >= current.length) return false;
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
  candidate: AnyGeneratedCharacterCandidate,
): string[] {
  const violations: string[] = [];
  if (brief.briefId && candidate.briefId !== brief.briefId) violations.push("生成指示のIDが一致しません");
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
      if (!isCharacterContentPointer(candidate, pointer))
        violations.push(`Pointer不正: ${coverage.profileSnapshotItemId}:${pointer}`);
    }
    if (coverage.status === "violated") violations.push(`coverage違反: ${coverage.profileSnapshotItemId}`);
    if (selection?.treatment === "required" && coverage.status !== "satisfied")
      violations.push(`必須の好み未達: ${coverage.profileSnapshotItemId}`);
    if (selection?.treatment === "prohibit" && coverage.status !== "satisfied")
      violations.push(`避ける好み違反: ${coverage.profileSnapshotItemId}`);
  }
  for (const id of expected.keys()) {
    const count = counts.get(id) ?? 0;
    if (count !== 1) violations.push(`coverage exactly-once違反: ${id}:${count}`);
  }
  return [...new Set(violations)];
}

export const GENERATION_POLICY_CHECKS = [
  "policy:unrequested_moralization",
  "policy:fictional_distance",
  "policy:creative_constraints",
] as const;

/** Derive acceptance from complete, internally consistent checks rather than an LLM summary flag. */
export function reconcileGenerationValidation(
  brief: GenerationCoverageBrief,
  candidate: AnyGeneratedCharacterCandidate,
  report: import("../../shared/schemas").GenerationValidationReport,
): import("../../shared/schemas").GenerationValidationReport {
  const violations = [...validateGenerationCoverage(brief, candidate), ...report.violations];
  const expected = new Map<string, string>([
    ...brief.preferenceSelections.map((item) => [item.profileSnapshotItemId, item.treatment] as const),
    ...GENERATION_POLICY_CHECKS.map((id) => [id, "required"] as const),
  ]);
  const counts = new Map<string, number>();
  for (const check of report.checks) {
    counts.set(check.constraintId, (counts.get(check.constraintId) ?? 0) + 1);
    const treatment = expected.get(check.constraintId);
    if (!treatment) violations.push(`未知の検査項目: ${check.constraintId}`);
    if (
      !check.outputPointers.length ||
      check.outputPointers.some((pointer) => !isCharacterContentPointer(candidate, pointer))
    )
      violations.push(`検査Pointer不正: ${check.constraintId}`);
    if (check.status === "violated") violations.push(`検査違反: ${check.constraintId}`);
    if ((treatment === "required" || treatment === "prohibit") && check.status !== "satisfied")
      violations.push(`必須・禁止条件の未確認: ${check.constraintId}`);
  }
  for (const id of expected.keys()) if (counts.get(id) !== 1) violations.push(`検査exactly-once違反: ${id}`);
  if (!report.passed && !violations.length) violations.push("全体判定と個別検査が矛盾しています");
  return { ...report, passed: violations.length === 0, violations: [...new Set(violations)] };
}

export function isCharacterContentPointer(candidate: unknown, pointer: string): boolean {
  return (
    pointer.startsWith("/") &&
    !/^\/(briefCoverage|briefId|schemaVersion|uncertainties)(\/|$)/u.test(pointer) &&
    jsonPointerExists(candidate, pointer)
  );
}
