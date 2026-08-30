import { describe, expect, it } from "vitest";
import { hasPreferenceAnalysisCandidates } from "../worker/services/analysis";

describe("preference analysis result validation", () => {
  it("treats a result without preferences or value stances as empty", () => {
    expect(hasPreferenceAnalysisCandidates({ preferenceAssertions: [], valueStanceAssertions: [] })).toBe(false);
  });

  it("accepts a result containing either kind of preference evidence", () => {
    expect(
      hasPreferenceAnalysisCandidates({
        preferenceAssertions: [{}] as never[],
        valueStanceAssertions: [],
      }),
    ).toBe(true);
    expect(
      hasPreferenceAnalysisCandidates({
        preferenceAssertions: [],
        valueStanceAssertions: [{}] as never[],
      }),
    ).toBe(true);
  });
});
