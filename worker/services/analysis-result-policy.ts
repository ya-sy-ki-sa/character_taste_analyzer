import type { PreferenceCandidate } from "../../shared/schemas";

export function hasPreferenceAnalysisCandidates(
  value: Pick<PreferenceCandidate, "preferenceAssertions" | "valueStanceAssertions">,
): boolean {
  return value.preferenceAssertions.length > 0 || value.valueStanceAssertions.length > 0;
}
