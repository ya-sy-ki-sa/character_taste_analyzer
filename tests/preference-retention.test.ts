import { expect, it } from "vitest";
import type { PreferenceHypothesis } from "../shared/quality-schemas";
import type { PreferenceCandidate } from "../shared/schemas";
import { mergeSelectedPreferenceHypotheses } from "../worker/services/preference-retention";

it("keeps the analyzed selection once, even when the model decomposes its scope, and fills only omissions", () => {
  const batch = crypto.randomUUID();
  const selected: PreferenceHypothesis = {
    id: crypto.randomUUID(),
    attributeStableKey: "personality.cold",
    rawLabel: "冷酷さ",
    polarity: "positive",
    responseChannel: "narrative_interest",
    scope: "敵対時だけ",
    description: "冷酷な敵対者が物語に緊張感を生む点が好き。",
    reason: "確認済み理解から考えられる仮説",
  };
  const candidate: PreferenceCandidate = {
    summary: { userExplicitSummary: [], inferredSummary: [], limitations: [] },
    valueStanceAssertions: [],
    uncertainties: [],
    preferenceAssertions: [
      {
        attributeStableKey: selected.attributeStableKey,
        rawLabel: selected.rawLabel,
        polarity: selected.polarity,
        responseChannel: "narrative_interest",
        strength: 0.8,
        explicitness: "user_confirmed",
        confidence: 0.9,
        context: {
          schemaVersion: "2",
          entryScope: null,
          subjects: [],
          relationships: [],
          narrativePhases: [],
          conditions: ["敵対する場面"],
          exceptions: [],
        },
        evidence: [
          {
            sourceRef: `input:preference/clarifications/${batch}/0`,
            sourceUrl: null,
            inputPointer: `/preference/clarifications/${batch}/0`,
            quote: selected.description,
            inferenceType: "direct",
          },
        ],
      },
    ],
  };
  mergeSelectedPreferenceHypotheses(candidate, [selected], batch, null);
  expect(candidate.preferenceAssertions).toHaveLength(1);
  expect(candidate.preferenceAssertions[0]).toMatchObject({
    explicitness: "user_confirmed",
    strength: 0.8,
    confidence: 0.9,
    context: { entryScope: "敵対時だけ", conditions: ["敵対する場面"] },
  });
  const missing = {
    ...selected,
    id: crypto.randomUUID(),
    attributeStableKey: "competence.intelligence",
    rawLabel: "知略",
  };
  mergeSelectedPreferenceHypotheses(candidate, [selected, missing], batch, null);
  expect(candidate.preferenceAssertions).toHaveLength(2);
  expect(candidate.preferenceAssertions[1].evidence[0].inputPointer).toBe(`/preference/clarifications/${batch}/1`);
});
