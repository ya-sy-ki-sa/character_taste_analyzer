const normalized = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/[\s、。・「」『』]/gu, "")
    .toLowerCase();

export function understandingInformationMetrics(snapshots) {
  const rows = snapshots.filter(Boolean);
  const assertions = rows.flatMap((row) => row.assertions ?? []);
  const canonical = new Set(
    rows.flatMap((row, caseIndex) =>
      (row.assertions ?? []).map(
        (item) => `${caseIndex}|${normalized(item.stable_key)}|${normalized(item.value_text)}|${item.explicitness}`,
      ),
    ),
  );
  return {
    snapshots: rows.length,
    assertionCount: assertions.length,
    canonicalAssertionCount: canonical.size,
    concreteAspectCount: rows.reduce((sum, row) => sum + (row.informationQuality?.concreteAspectCount ?? 0), 0),
    groundedConcreteItemCount: rows.reduce(
      (sum, row) => sum + (row.informationQuality?.groundedConcreteItemCount ?? 0),
      0,
    ),
    modelKnowledgeConcreteItemCount: rows.reduce(
      (sum, row) => sum + (row.informationQuality?.modelKnowledgeConcreteItemCount ?? 0),
      0,
    ),
    modelKnowledgeAssertionCount: assertions.filter((item) => item.explicitness === "model_knowledge").length,
    limitedCount: rows.filter((row) => row.informationQuality?.status === "limited").length,
    aspectCoverage: rows.reduce(
      (sum, row) =>
        sum + Object.values(row.informationQuality?.aspects ?? {}).filter((aspect) => aspect.kind !== "unknown").length,
      0,
    ),
    groundedCoverage: rows.reduce(
      (sum, row) =>
        sum +
        Object.values(row.informationQuality?.aspects ?? {}).filter(
          (aspect) =>
            aspect.kind !== "unknown" &&
            aspect.assertionIndexes?.some((index) =>
              (row.assertions?.[index]?.evidence ?? []).some(
                (evidence) =>
                  evidence.evidenceOrigin !== "model_knowledge" && evidence.verificationStatus !== "invalid",
              ),
            ),
        ).length,
      0,
    ),
  };
}

export function judgmentQuestionMetrics(audits) {
  const groups = new Map();
  for (const audit of audits) {
    for (const call of audit?.calls ?? []) {
      for (const answer of call.answers ?? []) {
        const family =
          answer.id?.replace(
            /^.*?_(?=evidence|scope|attribute|classification|channel|polarity|strength|explicitness|set|coverage)/u,
            "",
          ) ?? "unknown";
        const key = `${call.stage}|${answer.type}|${family}`;
        const row = groups.get(key) ?? {
          stage: call.stage,
          type: answer.type,
          questionFamily: family,
          answers: 0,
          lowConfidence: 0,
        };
        row.answers++;
        if (typeof answer.confidence === "number" && answer.confidence < 0.65) row.lowConfidence++;
        groups.set(key, row);
      }
    }
  }
  return [...groups.values()].map((row) => ({
    ...row,
    lowConfidenceRate: row.answers ? row.lowConfidence / row.answers : null,
    finalOutcomeContribution: null,
  }));
}

/** Manual review distinguishes an extra target from an unsupported reaction path. */
export function preferencePrecisionMetrics(review) {
  const decisions = Object.values(review?.cases ?? {}).flatMap((row) => Object.values(row.claims ?? {}));
  const dimension = (key) => {
    const judged = decisions.map((item) => item[key]).filter((value) => value === "correct" || value === "incorrect");
    const correct = judged.filter((value) => value === "correct").length;
    return { correct, assessed: judged.length, precision: judged.length ? correct / judged.length : null };
  };
  return { target: dimension("target"), responseChannel: dimension("responseChannel") };
}
