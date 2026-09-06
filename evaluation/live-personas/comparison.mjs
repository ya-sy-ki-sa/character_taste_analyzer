import { selectDataset } from "./selection.mjs";
import { digest } from "./storage.mjs";

const terminal = new Set(["complete", "failed", "held", "submission_failed"]);
const ratio = (numerator, denominator) => ({
  numerator,
  denominator,
  rate: denominator ? numerator / denominator : null,
});
const uniqueClaims = (row) => [...new Map(row.claims.map((c) => [`${c.stage}/${c.text}`, c])).values()];
export function summarizeCases(rows) {
  const expected = rows.flatMap((r) => r.expected).filter((e) => e.label !== "not_evaluable");
  const preference = rows.flatMap(uniqueClaims).filter((c) => c.stage === "preference");
  return {
    cases: rows.length,
    completion: ratio(rows.filter((r) => r.status === "complete").length, rows.length),
    firstPass: ratio(rows.filter((r) => r.status === "complete" && !r.retries).length, rows.length),
    failed: rows.filter((r) => ["failed", "submission_failed"].includes(r.status)).length,
    held: rows.filter((r) => r.status === "held").length,
    pending: rows.filter((r) => !terminal.has(r.status)).length,
    evaluated: rows.filter((r) => r.claims.some((c) => c.stage === "preference")).length,
    recall: ratio(expected.filter((e) => e.label === "matched").length, expected.length),
    support: ratio(preference.filter((c) => c.label === "supported").length, preference.length),
    emptyPreferenceCases: rows.filter((r) => r.metrics.structuredPreferenceCount === 0).map((r) => r.caseId),
  };
}
const points = (a, b) => (a === null || b === null ? null : (b - a) * 100);
function pairedSummary(before, after) {
  const baseline = summarizeCases(before);
  const current = summarizeCases(after);
  return {
    baseline,
    current,
    deltaPoints: Object.fromEntries(
      ["completion", "firstPass", "recall", "support"].map((k) => [k, points(baseline[k].rate, current[k].rate)]),
    ),
  };
}

export function compareRuns(baseline, current, baselineDataset, currentDataset, settings) {
  const beforeIds = baseline.records.map((r) => r.caseId);
  const afterIds = current.records.map((r) => r.caseId);
  if (
    digest(baselineDataset) !== baseline.datasetHash ||
    digest(currentDataset) !== current.datasetHash ||
    baseline.datasetHash !== current.datasetHash ||
    digest(beforeIds) !== digest(afterIds) ||
    digest(beforeIds) !== digest(baselineDataset.cases.map((c) => c.id)) ||
    new Set(beforeIds).size !== beforeIds.length
  )
    throw new Error("COMPARISON_DATASET_MISMATCH");
  const settingKeys = [
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_REASONING_EFFORT",
    "LLM_TIER_ROUTES_JSON",
    "LLM_FALLBACK_PROVIDER",
    "LLM_FALLBACK_MODEL",
    "LLM_FALLBACK_REASONING_EFFORT",
    "EMBEDDING_PROVIDER",
    "EMBEDDING_MODEL",
    "MODERATION_PROVIDER",
    "MODERATION_MODEL",
    "OPENAI_FLEX_ENABLED",
  ];
  for (const key of settingKeys)
    if (settings.baseline[key] !== settings.current[key]) throw new Error(`COMPARISON_SETTINGS_MISMATCH ${key}`);
  for (const run of [baseline, current]) {
    if (run.records.some((r) => r.claims.length && !r.codexReviewed))
      throw new Error("COMPARISON_REQUIRES_REVIEWED_GRADES");
    for (const model of [...run.usage.requestedModels, ...run.usage.responseModels])
      if (model !== settings.baseline.LLM_MODEL) throw new Error("COMPARISON_ACTUAL_MODEL_MISMATCH");
  }
  const byId = new Map(current.records.map((r) => [r.caseId, r]));
  const commonIds = baseline.records
    .filter(
      (r) =>
        r.claims.some((c) => c.stage === "preference") &&
        byId.get(r.caseId).claims.some((c) => c.stage === "preference"),
    )
    .map((r) => r.caseId);
  const common = new Set(commonIds);
  const rows = baseline.records.map((before) => {
    const after = byId.get(before.caseId);
    return {
      caseId: before.caseId,
      personaId: before.personaId,
      character: before.character,
      work: before.work,
      baselineStatus: before.status,
      currentStatus: after.status,
      baselineCandidates: before.metrics.structuredPreferenceCount,
      currentCandidates: after.metrics.structuredPreferenceCount,
      commonEvaluable: common.has(before.caseId),
      ...pairedSummary([before], [after]),
    };
  });
  return {
    schemaVersion: "persona-live-comparison/v1",
    generatedAt: new Date().toISOString(),
    baselineRun: baseline.runId,
    currentRun: current.runId,
    baselineStatus: baseline.status,
    currentStatus: current.status,
    datasetHash: baseline.datasetHash,
    settings: settings.current,
    all: pairedSummary(baseline.records, current.records),
    common: {
      caseIds: commonIds,
      ...pairedSummary(
        baseline.records.filter((r) => common.has(r.caseId)),
        current.records.filter((r) => common.has(r.caseId)),
      ),
    },
    byPersona: Object.fromEntries(
      baselineDataset.personas.map((p) => [
        p.id,
        {
          all: pairedSummary(
            baseline.records.filter((r) => r.personaId === p.id),
            current.records.filter((r) => r.personaId === p.id),
          ),
          common: pairedSummary(
            baseline.records.filter((r) => r.personaId === p.id && common.has(r.caseId)),
            current.records.filter((r) => r.personaId === p.id && common.has(r.caseId)),
          ),
        },
      ]),
    ),
    usage: { baseline: baseline.usage, current: current.usage },
    timing: { baseline: baseline.timingSummary, current: current.timingSummary },
    rows,
    limitations: [
      "同一60件・単一実行同士の比較。モデルや外部検索の変動を含むため、差を改修の因果効果と断定しない。",
      "共通ケース群でも生成された主張数は異なる。支持率は各出力の主張を分母とし、同一主張同士の正誤比較ではない。",
      "期待要素抽出率には要約での保持を含む。構造化候補とプロフィールへの反映は追加評価で別に確認する。",
      "確認不能、欠損、未実施を成功として補わない。引用文字列の検証件数や情報量は、意味的正確率ではない。",
    ],
  };
}

export function summarizeCorrections(records) {
  const changed = records.flatMap((r) => r.preferenceOperations ?? []).filter((a) => a.action !== "reject");
  return {
    representatives: records.length,
    completedRepresentatives: records.filter((r) => r.finalStatus === "active").length,
    unavailableRepresentatives: records.filter((r) => r.finalStatus !== "active").map((r) => r.caseId),
    mutatedPreferences: changed.length,
    withEvidence: changed.filter((a) => a.finalEvidenceCount > 0).length,
    withoutEvidence: changed.filter((a) => a.finalEvidenceCount === 0).length,
    evidenceNotObserved: changed.filter((a) => a.finalEvidenceCount == null).length,
    insufficientAfterCorrection: changed.filter((a) => a.dimension?.classification === "insufficient").length,
    records,
  };
}

/** Explicit subset comparisons verify the full original first; ordinary comparisons remain strict. */
export function compareSubsetRuns(baseline, current, baselineDataset, currentDataset, settings, caseIds) {
  if (
    digest(baselineDataset) !== baseline.datasetHash ||
    digest(baseline.records.map((r) => r.caseId)) !== digest(baselineDataset.cases.map((c) => c.id))
  )
    throw new Error("COMPARISON_DATASET_MISMATCH");
  const subset = selectDataset(baselineDataset, caseIds);
  if (digest(subset) !== digest(currentDataset)) throw new Error("COMPARISON_SUBSET_INPUT_MISMATCH");
  const selectedBaseline = {
    ...baseline,
    records: baseline.records.filter((r) => caseIds.includes(r.caseId)),
    datasetHash: digest(subset),
  };
  const result = compareRuns(selectedBaseline, current, subset, currentDataset, settings);
  result.selection = { caseIds, originalCaseCount: baseline.records.length, originalDatasetHash: baseline.datasetHash };
  // Full-run usage cannot stand in for the selected cases' usage. A separate attributed usage report may supply it.
  result.usage.baseline = { recordedAppModelCalls: null, inputTokens: null, outputTokens: null };
  result.timing.baseline = Object.fromEntries(
    ["understandingSeconds", "preferenceSeconds", "confirmationSeconds", "totalSeconds"].map((key) => {
      const values = selectedBaseline.records
        .map((r) => r.timing?.[key])
        .filter((v) => typeof v === "number")
        .sort((a, b) => a - b);
      return [
        key,
        {
          count: values.length,
          median: values.length ? values[Math.floor(values.length / 2)] : null,
          p90: values.length ? values[Math.ceil(values.length * 0.9) - 1] : null,
        },
      ];
    }),
  );
  result.limitations[0] = `事前指定した同一${caseIds.length}件の単一実行比較。差を改修の因果効果と断定しない。`;
  result.limitations.push(
    "登録数が異なるためプロフィールの集計値は前回15件時点と直接比較しない。処理量はケースに帰属できた記録だけを別集計する。",
  );
  return result;
}
