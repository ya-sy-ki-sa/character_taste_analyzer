import { caseFailed, type QualityReport } from "./report";
/** Observable indicators only. Human correction and adoption rates require real user decisions. */
export function qualityMetrics(report: Pick<QualityReport, "results">) {
  let expected = 0,
    matched = 0,
    emptyCases = 0,
    emptyFalsePositives = 0,
    verified = 0,
    evidenceCount = 0;
  const perCase = report.results.map((result) => {
    const assertions = "error" in result ? [] : result.assertions;
    const channels = new Set(assertions.map((item) => item.response_channel));
    const expectedChannels = "error" in result ? [] : result.expectedChannels;
    expected += expectedChannels.length;
    const hits = expectedChannels.filter((channel) => channels.has(channel)).length;
    matched += hits;
    if (!("error" in result) && result.expectsEmpty) {
      emptyCases++;
      if (assertions.length) emptyFalsePositives++;
    }
    const detail = "error" in result ? undefined : result.detail;
    for (const assertion of detail?.preferenceAnalysis?.assertions ?? [])
      for (const evidence of assertion.evidence ?? []) {
        evidenceCount++;
        if (["verified_quote", "source_attributed"].includes(evidence.verificationStatus)) verified++;
      }
    return {
      id: result.id,
      failed: caseFailed(result),
      assertionCount: assertions.length,
      expectedChannelHits: hits,
      expectedChannelCount: expectedChannels.length,
      absentEvidenceFalsePositive: Boolean(!("error" in result) && result.expectsEmpty && assertions.length),
    };
  });
  return {
    perCase,
    completedCases: perCase.filter((item) => !item.failed).length,
    totalCases: perCase.length,
    generatedCases: report.results.filter((item) => !("error" in item) && item.generation && !caseFailed(item)).length,
    generationFailedCases: report.results.filter((item) => !("error" in item) && item.generation && caseFailed(item))
      .length,
    generationSkippedCases: report.results.filter((item) => !("error" in item) && item.generationSkippedReason).length,
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
  baseline: Pick<QualityReport, "results">,
  current: Pick<QualityReport, "results">,
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
