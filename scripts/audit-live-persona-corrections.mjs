import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readJson, saveJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
const read = (path) => readJson(`${root}/${path}`);
const progress = read("progress.json");
const plan = read("correction-plan.json");
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const notes = {
  A07: "初回の好み候補0件から、理解を再生成・範囲を具体化した後の好み分析では保護的1件へ変化。候補が生じたこと自体は好みの手動修正の効果ではない。保護行動の表現を具体化し、普段との態度の差を手動追加した。",
  B02: "初回の理解には人物名・対象時期を細部の根拠とする不適切な接続があった。再生成の理解は同定・媒体・範囲の3候補だけとなり、好み分析は候補0件へ変化した。理解の根拠範囲を訂正し、明示された不器用さへの好みを追加。変化には再生成と理解の訂正が共に含まれ、因果効果を分離する対照試験ではない。",
  C11: "初回の否定ラベル反転は、好みを手動編集する前の再生成段階ですでに解消した。理解の『矛盾・不整合』を却下し、公式設定とユーザー解釈の区別を具体化。好みを二人の関係への関心として修正し、否定候補を却下した後、対象を限定した代替候補を追加した。",
  D10: "初回はURL照合で失敗。訂正工程の同入力再解析ではレビューへ到達した。これは手動訂正によるエラー修復ではない。1999年版・ハンター試験の対象指定を明示し、学生時代の期待感との結びつきを好みラベルへ具体化した。2011年版との優劣ではないという既存条件は保持された。",
};
const records = [];
for (const selected of plan.cases) {
  const id = selected.caseId;
  const state = progress.corrections[id];
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
      const dimensions = projection.profile.profile.dimensions.filter((x) => x.label === oldLabel);
      assert.equal(dimensions.length, 0);
      return { ...a, persisted: true, finalStatus: old.status, excludedFromCurrentProfile: true };
    }
    const changedId = state[a.key];
    const actual = corrected.preferenceAnalysis.assertions.find((x) => x.id === changedId);
    const row = exported.preferenceAnalysis.assertions.find((x) => x.id === changedId);
    assert(actual && row, `${id}/${a.key} missing`);
    assert.equal(actual.raw_label, a.expectedDisplayLabel ?? a.rawLabel);
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
    note: notes[id],
    understandingOperations,
    preferenceOperations: operations,
    uneditedValueStances: corrected.preferenceAnalysis.valueStances,
    finalProfileEntryCount: projection.profile.profile.entryCount,
    profileFreshness: projection.profile.freshness,
    graphFreshness: projection.graph.freshness,
    completedAt: state.completed,
  });
}
const mutated = records.flatMap((r) => r.preferenceOperations).filter((a) => a.action !== "reject");
const result = {
  auditedAt: new Date().toISOString(),
  method: "UIによる訂正と公開API・エクスポート・最終プロフィールの読み取り照合。初回採点へは加算しない。",
  completedRepresentatives: records.length,
  mutatedPreferences: mutated.length,
  insufficientAfterCorrection: mutated.filter((a) => a.dimension.classification === "insufficient").length,
  additionalFailedAttempts: plan.additionalFailedAttempts,
  records,
};
saveJson(`${root}/correction-results.json`, result);
const issueRows = [
  {
    id: "CORR-I1",
    phase: "correction",
    severity: "medium",
    cases: records.map((r) => r.caseId),
    title: "ユーザー訂正・追加後の好みが証拠0件・情報不足として低く集計される",
    expected:
      "ユーザーが元の登録文に基づいて訂正・追加した好みを、根拠と対象条件を追跡しながらプロフィールへ反映できる。",
    actual: `修正・追加した${mutated.length}候補全てがevidenceCount=0、classification=insufficient。プロフィール信頼度は約0.05〜0.06。更新4件は既存条件を保持したが、引用evidenceは引き継がれない。`,
    impact:
      "訂正内容は保存されるが、代表的な好みとしての重みが小さくなる。手動訂正すれば分析品質が回復するとは限らない。",
    hypothesis:
      "preference-review.tsの更新は新しいassertionを作り、元のcontextをコピーするがevidenceを複製しない。集計の証拠数依存と組み合わさる可能性。重み付け仕様の妥当性は別途検討が必要。",
    improvement:
      "訂正履歴と元の引用への接続、手動確認をどう信頼度へ反映するかを設計し、更新・追加・却下を含む集計回帰評価を追加する。",
    evidence:
      "correction-results.json / corrections/*/preference-regenerated.json / corrections/*/final.json / profiles/*/final.json",
  },
  {
    id: "CORR-I2",
    phase: "correction",
    severity: "low",
    cases: ["A07"],
    title: "対応済み属性の具体名を編集しても標準属性名が表示される",
    expected: "入力した具体的な好みの表現を、対応先の標準属性名と共に確認できる。",
    actual:
      "『仲間が傷つけられたときに真っ先に動き、友達を本気で守る姿』はDBに保存されたが、レビューAPIとプロフィールのラベルは『保護的』。公開エクスポートにはraw_attribute_mentions自体が含まれない。",
    impact: "具体化が保存されたか画面・公開エクスポートだけでは追跡しにくい。保存されていないと誤認しやすい。",
    hypothesis:
      "属性定義のラベルをraw mentionより優先して返す読取処理による表示。保存消失ではないことを読み取り専用DB照合で確認。",
    improvement: "標準属性名とユーザーの原文を併記し、エクスポートにも元表現を含めることを検討。",
    evidence: "corrections/A07/raw-label-audit.json / corrections/A07/edits.json / corrections/A07/final.json",
  },
];
saveJson(`${root}/correction-issues.json`, issueRows);
const csv = [
  "caseId,baselineStatus,finalStatus,baselinePreferenceCount,regeneratedPreferenceCount,correctedPreferenceCount",
  ...records.map((r) =>
    [
      r.caseId,
      r.baselineStatus,
      r.finalStatus,
      r.baselinePreferenceCount ?? "",
      r.regeneratedPreferenceCount,
      r.correctedPreferenceCount,
    ].join(","),
  ),
].join("\n");
writeFileSync(`${root}/correction-results.csv`, `${csv}\n`, { mode: 0o600 });
const md = [
  "# 初回・再生成・訂正後の比較",
  "",
  result.method,
  "",
  plan.deviation,
  "",
  "4人の代表例はすべて解析済みとなり、最後の再ログインでも各15登録を確認。初回の失敗3件のうちD10は再解析で完了したため、終了時の解析済み件数はA13/B15/C15/D15。初回の完了率は57/60のまま。",
  "",
  "| ケース | 初回状態 | 初回候補数 | 再生成候補数 | 訂正後候補数 |",
  "|---|---|---:|---:|---:|",
  ...records.map(
    (r) =>
      `| ${r.caseId} | ${r.baselineStatus} | ${r.baselinePreferenceCount ?? "未取得"} | ${r.regeneratedPreferenceCount} | ${r.correctedPreferenceCount} |`,
  ),
  "",
  ...records.flatMap((r) => [
    `## ${r.caseId}`,
    "",
    r.note,
    "",
    `理解の訂正・却下${r.understandingOperations.length}操作、好みの修正・追加・却下${r.preferenceOperations.length}操作を保存確認。[前後の原データ](corrections/${r.caseId}/verification.json)。`,
    "",
  ]),
  "## 反映の検証",
  "",
  "- 理解の更新4件と却下1件を確認。C11で却下した『矛盾・不整合』は確定理解・後続の好み候補に含まれない。",
  "- 好みの更新4件・追加3件・却下1件を確認。更新は新IDへ置換され、元IDはsuperseded。却下したC11の旧否定候補はrejectedとなり、現在のプロフィールから除かれた。",
  "- 更新4件の既存contextは保持。手動追加3件の条件欄は入力範囲と『ユーザーが確認画面で追加・修正』で、細部の対象条件はラベルへ明記した。",
  "- C11の『未分類の属性』という価値スタンス表示は好み候補と別データで、今回の好み修正後も残った。初回からの表示問題がすべて解消したとは扱わない。",
  "",
  "## 訂正工程で追加観測した問題",
  "",
  ...issueRows.flatMap((x) => [
    `### ${x.id} ${x.title}`,
    "",
    `重要度: ${x.severity}`,
    "",
    `観測: ${x.actual}`,
    "",
    `影響: ${x.impact}`,
    "",
    `原因・仮説: ${x.hypothesis}`,
    "",
    `改善案: ${x.improvement}`,
    "",
  ]),
  "[JSONの操作別・集計照合](correction-results.json) / [比較CSV](correction-results.csv) / [訂正工程の問題JSON](correction-issues.json)",
  "",
  "再生成された理解と訂正理解に基づく好み分析を比較しているため、出力差を全てモデルのばらつき、または全て訂正効果とすることはできない。初回・理解再生成・理解訂正後・好み訂正後・集計後をそれぞれ保存し、この区別を保っている。",
];
writeFileSync(`${root}/correction-results.md`, `${md.join("\n")}\n`, { mode: 0o600 });
console.log(`Audited ${records.length} representatives and ${mutated.length} changed preferences`);
