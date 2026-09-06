import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { summarizeCorrections } from "../evaluation/live-personas/comparison.mjs";
import { liveRunRoot, readJson, saveJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = liveRunRoot();
const read = (path) => readJson(`${root}/${path}`);
const progress = read("progress.json");
const plan = read("correction-plan.json");
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const review = readJson(`${root}/correction-review.json`, { cases: {}, issues: [] });
const records = [];
for (const selected of plan.cases) {
  const id = selected.caseId;
  const state = progress.corrections[id];
  const verification = read(`corrections/${id}/verification.json`);
  if (!verification) throw new Error(`Missing correction outcome ${id}`);
  if (verification.finalStatus !== "active") {
    records.push({
      ...selected,
      finalStatus: verification.finalStatus,
      note: verification.error ?? verification.reason,
      preferenceOperations: [],
      understandingOperations: [],
    });
    continue;
  }
  const edits = read(`corrections/${id}/edits.json`);
  const before = read(`corrections/${id}/baseline-before-reanalysis.json`);
  const regenerated = read(`corrections/${id}/preference-regenerated.json`);
  const understandingRegenerated = read(`corrections/${id}/understanding-regenerated.json`);
  const corrected = read(`corrections/${id}/final.json`);
  const exported = read(`exports/${selected.personaId}-final.json`);
  const projection = read(`profiles/${selected.personaId}/final.json`);
  assert.equal(corrected.entry.status, "active");
  assert.equal(read(`final-${selected.personaId}.json`).count, 15);
  assert.equal(exported.user.membership_tier, "basic");
  const operations = edits.preference.map((a) => {
    const old = exported.preferenceAnalysis.assertions.find((x) => x.id === a.targetId);
    if (a.action === "reject") {
      assert.equal(old?.status, "rejected");
      assert(!corrected.preferenceAnalysis.assertions.some((x) => x.id === a.targetId));
      const oldLabel = regenerated.preferenceAnalysis.assertions.find((x) => x.id === a.targetId)?.raw_label;
      const dimensions = projection.profile.profile.dimensions.filter(
        (x) =>
          x.label === oldLabel &&
          x.responseChannel === old.response_channel &&
          canonical(x.condition) === canonical(JSON.parse(old.context_json)),
      );
      assert.equal(dimensions.length, 0);
      return { ...a, persisted: true, finalStatus: old.status, excludedFromCurrentProfile: true };
    }
    const changedId = state[a.key];
    const actual = corrected.preferenceAnalysis.assertions.find((x) => x.id === changedId);
    const row = exported.preferenceAnalysis.assertions.find((x) => x.id === changedId);
    assert(actual && row, `${id}/${a.key} missing`);
    assert.equal(actual.raw_label, a.expectedDisplayLabel ?? a.rawLabel);
    assert.equal(row.originalLabel, a.rawLabel, `${id}/${a.key} original wording not exported`);
    assert.equal(actual.response_channel, a.responseChannel);
    assert.equal(actual.polarity, a.polarity);
    assert.equal(actual.status, "corrected");
    const context = JSON.parse(row.context_json);
    const dimensions = projection.profile.profile.dimensions.filter(
      (x) =>
        x.label === actual.raw_label &&
        x.responseChannel === a.responseChannel &&
        canonical(x.condition) === canonical(context),
    );
    assert.equal(dimensions.length, 1, `${id}/${a.key} profile match must be unique`);
    if (a.action === "update") {
      assert.equal(old?.status, "superseded");
      assert.equal(old.superseded_by_id, changedId);
      assert.equal(canonical(JSON.parse(old.context_json)), canonical(context));
    }
    return {
      ...a,
      changedId,
      persisted: true,
      originalLabel: row.originalLabel,
      finalStatus: actual.status,
      previousEvidenceCount:
        regenerated.preferenceAnalysis.assertions.find((x) => x.id === a.targetId)?.evidence.length ?? null,
      finalEvidenceCount: actual.evidence.length,
      previousContextPreserved: a.action === "update" ? true : null,
      dimension: dimensions[0],
    };
  });
  const understandingOperations = edits.understanding.map((a) => {
    const original = exported.understanding.assertions.find((x) => x.id === a.targetId);
    if (a.action === "delete") {
      assert.equal(original?.status, "rejected");
      assert(!corrected.understanding.assertions.some((x) => x.id === a.targetId));
      return { ...a, persisted: true, excludedFromConfirmedUnderstanding: true };
    }
    const actual = corrected.understanding.assertions.find((x) => x.value_text === a.valueText);
    assert(actual, `${id}/${a.key} missing understanding update`);
    assert.equal(actual.raw_label, a.rawLabel);
    const row = exported.understanding.assertions.find((x) => x.id === actual.id);
    assert.equal(row?.value_text, a.valueText);
    assert.equal(row?.raw_label, a.rawLabel);
    return { ...a, changedId: actual.id, persisted: true };
  });
  records.push({
    ...selected,
    entryId: state.entryId,
    baselineStatus: before.entry.status,
    finalStatus: corrected.entry.status,
    baselineUnderstandingCount: before.understanding?.assertions.length ?? null,
    regeneratedUnderstandingCount: understandingRegenerated.understanding?.assertions.length ?? null,
    baselinePreferenceCount: before.preferenceAnalysis?.assertions.length ?? null,
    regeneratedPreferenceCount: regenerated.preferenceAnalysis.assertions.length,
    correctedPreferenceCount: corrected.preferenceAnalysis.assertions.length,
    note:
      review.cases[id]?.note ?? "同入力の再生成・理解訂正・好み訂正を分離して保存。操作別の値は原出力との照合結果。",
    understandingOperations,
    preferenceOperations: operations,
    skippedOperations: edits.skippedOperations ?? [],
    uneditedValueStances: corrected.preferenceAnalysis.valueStances,
    finalProfileEntryCount: projection.profile.profile.entryCount,
    profileFreshness: projection.profile.freshness,
    graphFreshness: projection.graph.freshness,
    completedAt: state.completed,
  });
}
const result = {
  auditedAt: new Date().toISOString(),
  method: "UIによる訂正と公開API・エクスポート・最終プロフィールの読み取り照合。初回採点へは加算しない。",
  additionalFailedAttempts: plan.additionalFailedAttempts ?? [],
  additionalReanalyses: (plan.additionalReanalysisCases ?? []).map((caseId) => ({
    caseId,
    verification: readJson(`${root}/corrections/${caseId}/verification.json`, null),
  })),
  ...summarizeCorrections(records),
};
saveJson(`${root}/correction-results.json`, result);
const issueRows = [...review.issues];
if (result.withoutEvidence)
  issueRows.push({
    id: "CORR-EVIDENCE",
    phase: "correction",
    severity: "medium",
    cases: records
      .filter((r) => r.preferenceOperations.some((a) => a.action !== "reject" && a.finalEvidenceCount === 0))
      .map((r) => r.caseId),
    title: "訂正・追加された好みの根拠が0件",
    expected: "保存された本人申告を追跡できる根拠を伴ってプロフィールへ反映する。",
    actual: `修正・追加${result.mutatedPreferences}件のうち${result.withoutEvidence}件で根拠0件。`,
    impact: "根拠がない候補は集計品質が低くなる可能性がある。",
    hypothesis: "保存・根拠接続・集計を別々に調査する必要がある。",
    improvement: "操作別の原出力とエクスポートで欠落地点を確認する。",
  });
saveJson(`${root}/correction-issues.json`, issueRows);
const csv = [
  "caseId,baselineStatus,finalStatus,baselinePreferenceCount,regeneratedPreferenceCount,correctedPreferenceCount",
  ...records.map((r) =>
    [
      r.caseId,
      r.baselineStatus ?? "",
      r.finalStatus,
      r.baselinePreferenceCount ?? "",
      r.regeneratedPreferenceCount ?? "",
      r.correctedPreferenceCount ?? "",
    ].join(","),
  ),
].join("\n");
writeFileSync(`${root}/correction-results.csv`, `${csv}\n`, { mode: 0o600 });
const md = [
  "# 初回・再生成・訂正後の比較",
  "",
  result.method,
  "",
  plan.deviation ?? "",
  "",
  `代表${result.representatives}件のうち${result.completedRepresentatives}件がactive。未完了・実施不能: ${result.unavailableRepresentatives.join(", ") || "なし"}。`,
  `訂正・追加${result.mutatedPreferences}候補: 根拠あり${result.withEvidence}、根拠0件${result.withoutEvidence}、根拠数未取得${result.evidenceNotObserved}。情報不足の分類${result.insufficientAfterCorrection}件。`,
  "",
  "| ケース | 初回状態 | 最終状態 | 初回候補 | 再生成候補 | 訂正後候補 |",
  "|---|---|---|---:|---:|---:|",
  ...records.map(
    (r) =>
      `| ${r.caseId} | ${r.baselineStatus ?? "未取得"} | ${r.finalStatus} | ${r.baselinePreferenceCount ?? "未取得"} | ${r.regeneratedPreferenceCount ?? "未取得"} | ${r.correctedPreferenceCount ?? "未取得"} |`,
  ),
  "",
  ...records.flatMap((r) => [
    `## ${r.caseId}`,
    "",
    r.note ?? "",
    "",
    `理解の変更${r.understandingOperations.length}操作、好みの変更${r.preferenceOperations.length}操作。[前後の原データ](corrections/${r.caseId}/verification.json)。`,
    "",
    ...(r.skippedOperations ?? []).map((x) => `未実施 ${x.key}: ${x.reason}`),
    "",
  ]),
  "## 訂正工程で追加観測した問題",
  "",
  ...(issueRows.length
    ? issueRows.flatMap((x) => [`### ${x.id} ${x.title}`, "", x.actual, "", x.impact, ""])
    : ["追加の問題は今回の観測範囲では確認されなかった。", ""]),
  "初回・同入力再生成・理解訂正後・好み訂正後を分けて保存。初回との出力差を全て手動訂正の因果効果とは扱わない。",
  "[操作別JSON](correction-results.json) / [CSV](correction-results.csv) / [問題JSON](correction-issues.json)",
  "",
];
writeFileSync(`${root}/correction-results.md`, `${md.join("\n")}\n`, { mode: 0o600 });
console.log(
  `Audited ${result.completedRepresentatives}/${result.representatives} representatives and ${result.mutatedPreferences} changed preferences`,
);
