/** Observable indicators only. Human correction and adoption rates require real user decisions. */
export function qualityMetrics(report: { results: Array<Record<string, unknown>> }) {
  let expected = 0,
    matched = 0,
    emptyCases = 0,
    emptyFalsePositives = 0,
    verified = 0,
    evidenceCount = 0;
  const perCase = report.results.map((result) => {
    const assertions = (result.assertions ?? []) as Array<{ response_channel: string; polarity: string }>;
    const channels = new Set(assertions.map((item) => item.response_channel));
    const expectedChannels = (result.expectedChannels ?? []) as string[];
    expected += expectedChannels.length;
    const hits = expectedChannels.filter((channel) => channels.has(channel)).length;
    matched += hits;
    if (result.expectsEmpty) {
      emptyCases++;
      if (assertions.length) emptyFalsePositives++;
    }
    const detail = result.detail as
      | {
          preferenceAnalysis?: {
            assertions?: Array<{ evidence?: Array<{ verificationStatus?: string; verification_status?: string }> }>;
          };
        }
      | undefined;
    for (const assertion of detail?.preferenceAnalysis?.assertions ?? [])
      for (const evidence of assertion.evidence ?? []) {
        evidenceCount++;
        if (
          ["verified_quote", "source_attributed"].includes(
            evidence.verificationStatus ?? evidence.verification_status ?? "",
          )
        )
          verified++;
      }
    return {
      id: result.id,
      failed: Boolean(result.error),
      assertionCount: assertions.length,
      expectedChannelHits: hits,
      expectedChannelCount: expectedChannels.length,
      absentEvidenceFalsePositive: Boolean(result.expectsEmpty && assertions.length),
    };
  });
  return {
    perCase,
    completedCases: perCase.filter((item) => !item.failed).length,
    totalCases: perCase.length,
    expectedChannelRecall: expected ? matched / expected : null,
    absentEvidenceCases: emptyCases,
    absentEvidenceFalsePositives: emptyFalsePositives,
    attributableEvidenceRate: evidenceCount ? verified / evidenceCount : null,
    userCorrectionRate: null,
    userAdoptionRate: null,
    limitations: [
      "反応経路の一致は意味的正確性全体を保証しない。",
      "訂正率と採用率は実ユーザーの確認・採用イベントが必要であり、モデル出力から代用しない。",
      "不要な善化や主体性混同は保存した根拠と出力を別途レビューする。",
    ],
  };
}
export function compareQualityReports(
  baseline: { results: Array<Record<string, unknown>> },
  current: { results: Array<Record<string, unknown>> },
) {
  const before = qualityMetrics(baseline),
    after = qualityMetrics(current);
  if (JSON.stringify(before.perCase.map((item) => item.id)) !== JSON.stringify(after.perCase.map((item) => item.id)))
    throw new Error("Baseline and current fixture IDs/order must match");
  return {
    baseline: before,
    current: after,
    pairedCases: after.perCase.map((item, index) => ({
      id: item.id,
      assertionCountChange: item.assertionCount - before.perCase[index].assertionCount,
      expectedChannelHitsChange: item.expectedChannelHits - before.perCase[index].expectedChannelHits,
      absentEvidenceFalsePositiveBefore: before.perCase[index].absentEvidenceFalsePositive,
      absentEvidenceFalsePositiveAfter: item.absentEvidenceFalsePositive,
    })),
  };
}
