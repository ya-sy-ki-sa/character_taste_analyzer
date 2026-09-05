import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest, readJson, saveJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
const dataset = readJson(`${root}/dataset.json`);
if (digest(dataset) !== readJson(`${root}/dataset-manifest.json`).sha256) throw new Error("Frozen dataset changed");
const progress = readJson(`${root}/progress.json`);
const terminal = new Set(["complete", "failed", "held", "submission_failed"]);
const csv = (rows, keys) =>
  `${[keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n")}\n`;
const write = (path, text) => writeFileSync(`${root}/${path}`, text, { mode: 0o600 });
const count = (items) =>
  items.reduce((o, x) => {
    o[x.label] = (o[x.label] ?? 0) + 1;
    return o;
  }, {});
const ratio = (a, b) => (b ? a / b : null);
// Repeated text is retained in claims.csv but contributes only once to rates.
const uniqueClaims = (claims) => [
  ...new Map(claims.map((c) => [`${c.caseId ?? ""}/${c.stage}/${c.text}`, c])).values(),
];
const percent = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const elapsed = (a, b) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) / 1000 : null);
const reviews = readJson(`${root}/codex-review.json`, { cases: {} });
const records = dataset.cases.map((c) => {
  const state = progress.cases[c.id] ?? { status: "not_started" };
  const assisted = readJson(`${root}/grading-v2/${c.id}.json`, null);
  const review = reviews.cases[c.id];
  const rawPreference = readJson(`${root}/cases/${c.id}/preference-before.json`, null)?.preferenceAnalysis;
  const claims = (assisted?.claims ?? []).map((g) => ({ ...g, ...(review?.claimOverrides?.[g.id] ?? {}) }));
  const expected = (
    assisted?.expected ??
    c.gold.expected.map((e) => ({
      id: e.id,
      label: "not_evaluable",
      reason: state.error ?? "好み出力または採点が未取得",
    }))
  ).map((g) => ({ ...g, ...(review?.expectedOverrides?.[g.id] ?? {}) }));
  const unique = uniqueClaims(claims);
  const prefClaims = unique.filter((x) => x.stage === "preference");
  const factClaims = unique.filter((x) => x.stage === "understanding");
  const applicable = expected.filter((x) => x.label !== "not_evaluable");
  const issues = review?.issues ?? assisted?.issues ?? [];
  return {
    caseId: c.id,
    personaId: c.personaId,
    character: c.input.characterName,
    work: c.input.workTitle,
    lengthClass: c.lengthClass,
    entryId: state.entryId ?? null,
    jobId: state.jobId ?? null,
    status: state.status ?? "running",
    retries: state.retries ?? 0,
    error: state.error ?? null,
    expected,
    claims,
    issues,
    codexReviewed: Boolean(review),
    notes: review?.notes ?? assisted?.judgmentNotes ?? null,
    metrics: {
      structuredPreferenceCount: rawPreference?.assertions.length ?? null,
      structuredStanceCount: rawPreference?.valueStances.length ?? null,
      evidenceInsufficient: rawPreference?.qualityContext?.evidenceInsufficient ?? null,
      expected: count(expected),
      claims: count(claims),
      duplicateClaimSlots: claims.length - unique.length,
      allClaimSupportRate: ratio(unique.filter((x) => x.label === "supported").length, unique.length),
      facts: count(factClaims),
      preference: count(prefClaims),
      recall: ratio(expected.filter((x) => x.label === "matched").length, applicable.length),
      supportRate: ratio(prefClaims.filter((x) => x.label === "supported").length, prefClaims.length),
    },
    timing: {
      understandingSeconds: elapsed(state.submittedAt, state.understandingAt),
      preferenceSeconds: elapsed(state.understandingAt, state.preferenceAt),
      confirmationSeconds: elapsed(state.preferenceAt, state.completedAt),
      totalSeconds: elapsed(state.submittedAt, state.completedAt),
    },
    evidence: {
      input: `cases/${c.id}/submitted-input.json`,
      understanding: `cases/${c.id}/understanding-before.json`,
      preference: `cases/${c.id}/preference-before.json`,
      final: `cases/${c.id}/baseline-final.json`,
      assistedGrade: `grading-v2/${c.id}.json`,
      sources: c.research.sourceIds,
    },
  };
});
function aggregate(rows) {
  const expected = rows.flatMap((x) => x.expected).filter((x) => x.label !== "not_evaluable");
  const claims = rows.flatMap((x) => uniqueClaims(x.claims));
  const pref = claims.filter((x) => x.stage === "preference");
  return {
    planned: rows.length,
    complete: rows.filter((x) => x.status === "complete").length,
    firstPassComplete: rows.filter((x) => x.status === "complete" && !x.retries).length,
    completeAfterRetry: rows.filter((x) => x.status === "complete" && x.retries).length,
    failed: rows.filter((x) => ["failed", "submission_failed"].includes(x.status)).length,
    held: rows.filter((x) => x.status === "held").length,
    unresolved: rows.filter((x) => !terminal.has(x.status)).length,
    evaluated: rows.filter((x) => x.claims.length).length,
    codexReviewed: rows.filter((x) => x.codexReviewed).length,
    recall: ratio(expected.filter((x) => x.label === "matched").length, expected.length),
    supportRate: ratio(pref.filter((x) => x.label === "supported").length, pref.length),
    allClaimSupportRate: ratio(claims.filter((x) => x.label === "supported").length, claims.length),
    duplicateClaimSlots: rows.reduce((n, x) => n + x.metrics.duplicateClaimSlots, 0),
    expected: count(rows.flatMap((x) => x.expected)),
    understanding: count(claims.filter((x) => x.stage === "understanding")),
    preference: count(pref),
    issues: rows.flatMap((x) => x.issues).length,
    emptyPreferenceCases: rows.filter((x) => x.metrics.structuredPreferenceCount === 0).map((x) => x.caseId),
  };
}
const byPersona = Object.fromEntries(
  dataset.personas.map((p) => [p.id, aggregate(records.filter((c) => c.personaId === p.id))]),
);
const overall = aggregate(records);
const modelRows = [];
for (const p of dataset.personas) {
  const exported =
    readJson(`${root}/exports/${p.id}-final.json`, null) ?? readJson(`${root}/exports/${p.id}-baseline.json`, null);
  for (const m of exported?.operations?.modelRuns ?? []) {
    const effective = JSON.parse(m.effective_settings_json ?? "{}");
    const jobId = effective.llmRouting?.jobId;
    modelRows.push({
      ...m,
      personaId: p.id,
      jobId,
      caseId:
        records.find((c) => c.jobId === jobId)?.caseId ??
        Object.entries(progress.corrections ?? {}).find(([, c]) => c.jobId === jobId)?.[0] ??
        null,
      phase: records.some((c) => c.jobId === jobId)
        ? "baseline"
        : Object.values(progress.corrections ?? {}).some((c) => c.jobId === jobId)
          ? "correction"
          : "excluded_pilot_or_other",
      effort: effective.reasoningEffort ?? null,
      membershipTier: effective.llmRouting?.membershipTier ?? null,
    });
  }
}
const baselineModels = modelRows.filter((x) => x.phase === "baseline");
const usage = {
  recordedAppModelCalls: baselineModels.length,
  excludedOrOtherCalls: modelRows.filter((x) => x.phase === "excluded_pilot_or_other").length,
  correctionModelCalls: modelRows.filter((x) => x.phase === "correction").length,
  requestedModels: [...new Set(baselineModels.map((x) => x.requested_model))],
  responseModels: [...new Set(baselineModels.map((x) => x.resolved_model))],
  inputTokens: baselineModels.some((x) => x.input_token_estimate !== null)
    ? baselineModels.reduce((n, x) => n + (x.input_token_estimate ?? 0), 0)
    : null,
  outputTokens: baselineModels.some((x) => x.output_token_estimate !== null)
    ? baselineModels.reduce((n, x) => n + (x.output_token_estimate ?? 0), 0)
    : null,
  missingTokenRows: baselineModels.filter((x) => x.input_token_estimate === null || x.output_token_estimate === null)
    .length,
  billingBreakdown: null,
  embeddingCallCount: null,
  moderationCallCount: null,
  byPhase: Object.fromEntries(
    ["baseline", "correction", "excluded_pilot_or_other"].map((phase) => {
      const rows = modelRows.filter((x) => x.phase === phase);
      return [
        phase,
        {
          calls: rows.length,
          inputTokens: rows.reduce((n, x) => n + (x.input_token_estimate ?? 0), 0),
          outputTokens: rows.reduce((n, x) => n + (x.output_token_estimate ?? 0), 0),
          missingTokenRows: rows.filter((x) => x.input_token_estimate === null || x.output_token_estimate === null)
            .length,
        },
      ];
    }),
  ),
  note: "トークン列はlegacy名token_estimateだが、現OpenAIアダプタはResponses APIのusage値を保存する。欠損は補完しない。課金額・Embedding/Moderationの回数はこの公開エクスポートでは取得不可。採点補助APIの使用量はgrading-v2/rawへ別保存。",
};
const correctionPlan = readJson(`${root}/correction-plan.json`, null);
const corrections = (correctionPlan?.cases ?? []).map((x) => ({
  ...x,
  verification: readJson(`${root}/corrections/${x.caseId}/verification.json`, null),
}));
const profileReview = readJson(`${root}/profile-review.json`, null);
const secondPass = readJson(`${root}/second-pass.json`, null);
const correctionAudit = readJson(`${root}/correction-results.json`, null);
const correctionIssues = readJson(`${root}/correction-issues.json`, []);
const finalRequested = process.env.LIVE_FINAL === "1";
const timingSummary = Object.fromEntries(
  ["understandingSeconds", "preferenceSeconds", "confirmationSeconds", "totalSeconds"].map((key) => {
    const values = records
      .map((r) => r.timing[key])
      .filter((x) => x !== null)
      .sort((a, b) => a - b);
    return [
      key,
      {
        count: values.length,
        median: values.length ? values[Math.floor(values.length / 2)] : null,
        p90: values.length ? values[Math.ceil(values.length * 0.9) - 1] : null,
        maximum: values.at(-1) ?? null,
      },
    ];
  }),
);
if (
  finalRequested &&
  (overall.unresolved ||
    records.some((c) => !c.codexReviewed) ||
    !secondPass ||
    !profileReview ||
    !correctionAudit ||
    !readJson(`${root}/report-findings.json`, null) ||
    corrections.length !== 4 ||
    corrections.some((c) => !c.verification) ||
    dataset.personas.some(
      (p) =>
        !readJson(`${root}/exports/${p.id}-baseline.json`, null) ||
        !readJson(`${root}/exports/${p.id}-final.json`, null) ||
        readJson(`${root}/final-${p.id}.json`, null)?.count !== 15,
    ))
)
  throw new Error("Final report requires all outcomes, Codex review, second pass and profile review");
const result = {
  runId: root.split("/").at(-1),
  generatedAt: new Date().toISOString(),
  status: finalRequested ? "complete" : "in_progress",
  method: "Codexによる合成データ・自動評価。OpenAIの構造化採点補助とCodex再点検。実利用者の満足度を示すものではない。",
  datasetHash: digest(dataset),
  overall,
  byPersona,
  usage,
  timingSummary,
  records,
  corrections,
  profileReview,
  secondPass,
  correctionAudit,
  correctionIssues,
};
saveJson(`${root}/evaluation.json`, result);
saveJson(`${root}/model-runs.json`, modelRows);
write(
  "evaluation.csv",
  csv(
    records.map((c) => ({
      caseId: c.caseId,
      personaId: c.personaId,
      character: c.character,
      status: c.status,
      retries: c.retries,
      expectedMatched: c.metrics.expected.matched ?? 0,
      expectedPartial: c.metrics.expected.partial ?? 0,
      expectedMissed: c.metrics.expected.missed ?? 0,
      recall: c.metrics.recall,
      preferenceSupported: c.metrics.preference.supported ?? 0,
      preferencePartial: c.metrics.preference.partial ?? 0,
      preferenceUnsupported: c.metrics.preference.unsupported ?? 0,
      preferenceContradicted: c.metrics.preference.contradicted ?? 0,
      supportRate: c.metrics.supportRate,
      factsUnverifiable: c.metrics.facts.unverifiable ?? 0,
      issues: c.issues.length,
      totalSeconds: c.timing.totalSeconds,
      error: c.error,
      codexReviewed: c.codexReviewed,
      structuredPreferenceCount: c.metrics.structuredPreferenceCount,
      structuredStanceCount: c.metrics.structuredStanceCount,
      evidenceInsufficient: c.metrics.evidenceInsufficient,
    })),
    [
      "caseId",
      "personaId",
      "character",
      "status",
      "retries",
      "expectedMatched",
      "expectedPartial",
      "expectedMissed",
      "recall",
      "preferenceSupported",
      "preferencePartial",
      "preferenceUnsupported",
      "preferenceContradicted",
      "supportRate",
      "factsUnverifiable",
      "issues",
      "totalSeconds",
      "error",
      "codexReviewed",
      "structuredPreferenceCount",
      "structuredStanceCount",
      "evidenceInsufficient",
    ],
  ),
);
write(
  "claims.csv",
  csv(
    records.flatMap((c) => c.claims.map((x) => ({ ...x, caseId: c.caseId }))),
    ["caseId", "id", "stage", "pointer", "text", "label", "reason", "evidence"],
  ),
);
write(
  "expected.csv",
  csv(
    records.flatMap((c) => c.expected.map((x) => ({ ...x, caseId: c.caseId, claimIds: x.claimIds?.join(" ") }))),
    ["caseId", "id", "label", "claimIds", "reason"],
  ),
);
write(
  "model-runs.csv",
  csv(modelRows, [
    "caseId",
    "personaId",
    "phase",
    "provider",
    "requested_model",
    "resolved_model",
    "operation",
    "prompt_version",
    "prompt_hash",
    "effort",
    "membershipTier",
    "input_token_estimate",
    "output_token_estimate",
    "latency_ms",
    "created_at",
  ]),
);
const issueRows = records.flatMap((c) =>
  c.issues.map((x, i) => ({
    ...x,
    id: `${c.caseId}-I${i + 1}`,
    caseId: c.caseId,
    input: dataset.cases.find((x) => x.id === c.caseId).input.preference.likedReasons,
    claims: x.claimIds?.join(" "),
  })),
);
saveJson(`${root}/issues.json`, issueRows);
saveJson(`${root}/all-issues.json`, [...issueRows.map((x) => ({ ...x, phase: "baseline" })), ...correctionIssues]);
const groupFor = (x) => {
  if (/CITATION|URL|参照.*照合/.test(`${x.title} ${x.actual}`)) return "reference_url_validation";
  if (/候補.*(空|残らない|不能)|集計.*候補|response channel未選択/.test(`${x.title} ${x.actual}`))
    return "empty_preference_candidates";
  if (/引用|根拠|evidence/.test(x.title)) return "evidence_provenance";
  if (/重複/.test(x.title)) return "duplicate_display";
  if (/分類|対応付け|縮約|忠実|宿敵/.test(x.title) && !/経路|感情/.test(x.title)) return "attribute_mapping";
  if (/経路|感情|安心/.test(x.title)) return "response_channel_mapping";
  return "other";
};
const groupedIssues = Object.entries(Object.groupBy(issueRows, groupFor)).map(([id, rows]) => ({
  id,
  caseCount: new Set(rows.map((x) => x.caseId)).size,
  issueCount: rows.length,
  cases: [...new Set(rows.map((x) => x.caseId))],
  issueIds: rows.map((x) => x.id),
  stageClaimCounts: Object.fromEntries(
    ["understanding", "preference"].map((stage) => [
      stage,
      new Set(
        rows.flatMap((x) =>
          (x.claimIds ?? [])
            .filter(
              (id) => records.find((c) => c.caseId === x.caseId)?.claims.find((q) => q.id === id)?.stage === stage,
            )
            .map((id) => `${x.caseId}/${id}`),
        ),
      ).size,
    ]),
  ),
  hypothesis: "同種の観測をまとめた原因候補。共通の実装原因があることを確定したものではない。",
}));
saveJson(`${root}/issue-groups.json`, groupedIssues);
write(
  "issues.md",
  [
    "# 問題一覧",
    "",
    overall.codexReviewed === 60
      ? "初回60件はCodex再点検済み。以下は初回の指摘と、別枠の訂正工程の指摘。原因の確定には別の検証が必要。"
      : "Codex再点検が完了していないケースの指摘は暫定。原因の確定には別の検証が必要。",
    "",
    "同一原因候補の集計（同じ出力の要約と候補を段階内で重複加点しない。主張件数は別表示）:",
    "",
    "| 原因候補 | ケース数 | 指摘数 | 理解の主張 | 好みの主張 |",
    "|---|---:|---:|---:|---:|",
    ...groupedIssues.map(
      (g) =>
        `| ${g.id} | ${g.caseCount} | ${g.issueCount} | ${g.stageClaimCounts.understanding} | ${g.stageClaimCounts.preference} |`,
    ),
    "",
    ...issueRows.flatMap((x) => [
      `## ${x.id} ${x.title}`,
      `重要度: ${x.severity} / ケース: ${x.caseId} / 主張: ${x.claims}`,
      `再現入力: ${x.input}`,
      `期待: ${x.expected}`,
      `実結果（観測）: ${x.actual}`,
      `判定根拠: ${x.reason}`,
      `影響: ${x.impact ?? "当該登録の理解・好み表示や、確認後の累積集計に影響する可能性。"}`,
      `原因仮説: ${x.hypothesis ?? "分類への対応付け、根拠範囲の保持、または要約の過程に原因がある可能性。今回の観測だけでは確定しない。"}`,
      `改善案: ${x.improvement ?? "再現入力を回帰評価に追加し、入力の否定・条件・対象と分類の意味を合わせて検証する。"}`,
      `[実出力・失敗記録](cases/${x.caseId}/${readJson(`${root}/cases/${x.caseId}/preference-before.json`, null) ? "preference-before.json" : "failure-0.json"})`,
      "",
    ]),
    "## 訂正工程で追加観測した問題（初回30件の指摘と別集計）",
    "",
    ...correctionIssues.flatMap((x) => [
      `### ${x.id} ${x.title}`,
      "",
      `重要度: ${x.severity} / ケース: ${x.cases.join(", ")}`,
      "",
      `期待: ${x.expected}`,
      "",
      `実結果（観測）: ${x.actual}`,
      "",
      `影響: ${x.impact}`,
      "",
      `原因・仮説: ${x.hypothesis}`,
      "",
      `改善案: ${x.improvement}`,
      "",
      "[操作と前後比較](correction-results.md) / [根拠JSON](correction-results.json)",
      "",
    ]),
  ].join("\n"),
);
const table = [
  "| 人物 | 完了/15 | 意味評価件数 | 期待要素抽出率 | 根拠支持率 | 指摘数 |",
  "|---|---:|---:|---:|---:|---:|",
  ...dataset.personas.map((p) => {
    const a = byPersona[p.id];
    return `| ${p.label} | ${a.complete} | ${a.evaluated} | ${percent(a.recall)} | ${percent(a.supportRate)} | ${a.issues} |`;
  }),
];
const narrative = readJson(`${root}/report-findings.json`, {
  paragraphs: ["測定と採点を実施中。完了数や率は途中経過であり、最終結論ではありません。"],
  limitations: [],
});
const md = [
  "# 4人×15キャラクター 実API評価",
  ``,
  `状態: ${finalRequested ? "完了" : "実施中"} / ${result.generatedAt}`,
  "",
  result.method,
  "",
  ...narrative.paragraphs,
  "",
  "## 条件と全体結果",
  "",
  `開発環境 http://localhost:5173 / npm run dev / 永続DB / 通常版 / 全員ベーシック。データハッシュ: ${result.datasetHash}`,
  "",
  `完了 ${overall.complete}/60（初回 ${overall.firstPassComplete}、再試行後 ${overall.completeAfterRetry}）、失敗 ${overall.failed}、保留 ${overall.held}、未確定 ${overall.unresolved}。意味評価 ${overall.evaluated}/60。`,
  "",
  ...table,
  "",
  "抽出率 = matched / 評価対象の期待要素。根拠支持率 = supported / 好み出力の評価対象主張。部分一致・確認不能は成功へ足さず別件数とする。作品理解の裏付け不足と事実誤りは区別する。",
  `構造化された好み候補が0件のケース: ${overall.emptyPreferenceCases.join(", ")}。要約に残るだけでも意味の抽出はmatchedになり得るため、候補数・集計への保持を別途確認した。情報不足による適切な保留も含む。`,
  `期待要素の内訳: ${JSON.stringify(overall.expected)}。作品理解の主張内訳: ${JSON.stringify(overall.understanding)}。好みの主張内訳: ${JSON.stringify(overall.preference)}。`,
  `全段階を合わせた根拠支持率は${percent(overall.allClaimSupportRate)}。表の支持率は好み段階のみ。完全に同文・同段階の重複${overall.duplicateClaimSlots}枠は率へ重ねて加点せず、原記録には残す。`,
  "",
  `要求モデル: ${usage.requestedModels.join(", ") || "集計待ち"} / 応答モデル: ${usage.responseModels.join(", ") || "集計待ち"} / effortは未指定(null)。モデル既定値を実リクエストの指定値として扱わない。`,
  `LLM実行記録 ${usage.recordedAppModelCalls}件。取得済みinput tokens ${usage.inputTokens ?? "不明"} / output tokens ${usage.outputTokens ?? "不明"}。`,
  `訂正検証のモデル実行記録は別に${usage.correctionModelCalls}件。条件外予備実行等は${usage.excludedOrOtherCalls}件。`,
  `初回完了ケースの登録保存から集計完了まで: 中央値${timingSummary.totalSeconds.median?.toFixed(1) ?? "—"}秒、P90 ${timingSummary.totalSeconds.p90?.toFixed(1) ?? "—"}秒（${timingSummary.totalSeconds.count}件）。UI確認・待機を含む経過時間で、モデル応答時間そのものとは区別する。段階別はevaluation.jsonのtimingSummary。`,
  usage.note,
  "",
  "## 初回結果と訂正",
  "",
  "初回は内容を変更せず、次工程へ進む確認操作のみ実施。確認は正しさの承認・満足度とは扱わない。A01の反応経路が初期選択のまま送信された2版は条件外の予備実行として除外し、同一登録の第3版を本測定へ採用した。履歴と実行量は別保存。",
  "",
  "初回60件と全アカウントのエクスポート保存後に代表例を同じ入力で再解析し、再生成・訂正・集計後を分離して保存した。",
  "",
  ...corrections.map(
    (x) => `- ${x.caseId}: ${x.reason ?? "代表例"} / 最終状態 ${x.verification?.finalStatus ?? "未完了"}`,
  ),
  ...(correctionPlan?.deviation ? ["", correctionPlan.deviation] : []),
  ...(correctionAudit
    ? [
        "",
        `訂正・追加した好み${correctionAudit.mutatedPreferences}候補は全て保存・集計されたが、そのうち${correctionAudit.insufficientAfterCorrection}候補が証拠0件・insufficient。修正の保存成功と集計品質の回復は区別する。訂正工程の追加指摘${correctionIssues.length}件は初回の${overall.issues}件へ混ぜない。`,
      ]
    : []),
  "",
  "## 累積プロフィールと共通キャラの比較",
  "",
  ...(profileReview?.findings ?? []).map((x) => `- **${x.title}**: ${x.observation} ${x.interpretation}`),
  "",
  "| 同じキャラクター | ケース | 比較結果 |",
  "|---|---|---|",
  ...(profileReview?.commonCharacterComparisons ?? []).map(
    (x) => `| ${x.character} | ${x.cases.join(" / ")} | ${x.observed} ${x.result} |`,
  ),
  "",
  `固定シードの別パス再採点: ${secondPass?.cases.length ?? 0}件、${secondPass?.totalClaims ?? 0}主張。初回採点と別パス補助の不一致${secondPass?.disagreements ?? 0}件は、根拠付きの裁定とともに保存。追加の公式確認資料の有無による差も含む。`,
  "",
  "## 閲覧資料",
  "",
  "- [事前調査・入力](research.md)",
  "- [60件の評価表](evaluation.csv) / [主張単位の採点](claims.csv)",
  "- [問題一覧](issues.md)",
  "- [全評価データ](evaluation.json)",
  "- [モデル実行記録](model-runs.csv) / [採点補助の使用量](grading-usage.json)",
  "- [累積プロフィール・共通キャラ比較](profile-review.json) / [人物別指標SVG](persona-metrics.svg)",
  "- [固定シードの別パス採点](second-pass.json)",
  "- [重大・曖昧な指摘の再点検](major-issue-recheck.json)",
  "- [Codexによる採点補助の再点検](codex-review.json) / [追加の事実確認資料](source-verification-supplement.json)",
  "- [訂正検証の詳細](correction-results.md)",
  "- [アプリでの確認手順](verification-guide.md)",
  "- [自動化の修正・測定条件外の記録](test-harness-deviations.json)",
  "- [実行とチェックの一覧](execution-summary.json)",
  "",
  "## 限界",
  "",
  "- 架空4人の合成データであり、年代・性別集団や実利用者を代表しない。",
  "- 公式資料で確認できない細部は確認不能。未確認を誤り・正解へ寄せない。",
  "- 同じ提供元・モデル系列を採点補助にも使うため、評価の誤りが相関する可能性がある。Codexの別パスでも人による独立評価の代替とはしない。",
  "- 一回の測定から厳密な再現性や一般的な満足度は結論づけない。",
  ...narrative.limitations.map((x) => `- ${x}`),
  "",
];
write("report.md", md.join("\n"));
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const htmlTable = `<table><thead><tr><th>人物</th><th>完了</th><th>意味評価</th><th>抽出率</th><th>根拠支持率</th><th>指摘</th></tr></thead><tbody>${dataset.personas
  .map((p) => {
    const a = byPersona[p.id];
    return `<tr><th>${esc(p.label)} ${esc(p.name)}</th><td>${a.complete}/15</td><td>${a.evaluated}</td><td>${percent(a.recall)}</td><td>${percent(a.supportRate)}</td><td>${a.issues}</td></tr>`;
  })
  .join("")}</tbody></table>`;
const bars = dataset.personas
  .map((p, i) => {
    const a = byPersona[p.id];
    return `<text x="10" y="${33 + i * 55}">${p.label}</text><rect x="45" y="${15 + i * 55}" width="${480 * (a.recall ?? 0)}" height="15" fill="#156f8a"/><rect x="45" y="${33 + i * 55}" width="${480 * (a.supportRate ?? 0)}" height="15" fill="#bc6527"/>`;
  })
  .join("");
const screenshots = dataset.personas
  .map(
    (p) =>
      `<figure><img loading="lazy" src="profiles/${p.id}/15.png" alt="${p.label} 15件時点のプロフィール"><figcaption>${p.label} 初回15件時点 · <a href="profiles/${p.id}/15.png">全画面を見る</a></figcaption></figure>`,
  )
  .join("");
const evidenceLinks = (c) =>
  c.status === "failed"
    ? `<a href="cases/${c.caseId}/failure-0.json">初回失敗の詳細</a>`
    : `<a href="${c.evidence.understanding}">理解の原出力</a> · <a href="${c.evidence.preference}">好みの原出力</a>`;
const profileHtml = (profileReview?.findings ?? [])
  .map((x) => `<p><b>${esc(x.title)}</b><br>${esc(x.observation)} ${esc(x.interpretation)}</p>`)
  .join("");
const correctionHtml = corrections
  .map(
    (x) =>
      `<details><summary>${x.caseId} ${esc(x.verification?.finalStatus ?? "未完了")}</summary><p>${esc(x.reason)}</p><p><a href="corrections/${x.caseId}/verification.json">訂正記録</a></p>${x.verification?.finalStatus === "active" ? `<img loading="lazy" src="corrections/${x.caseId}/corrected-review.png" alt="${x.caseId} 訂正後のレビュー">` : ""}</details>`,
  )
  .join("");
const detailHtml = records
  .map(
    (c) =>
      `<details class="case" data-persona="${c.personaId}" data-search="${esc(`${c.caseId} ${c.character} ${c.work}`)}"><summary>${c.caseId} ${esc(c.character)} <small>${c.status} / 抽出 ${percent(c.metrics.recall)} / 支持 ${percent(c.metrics.supportRate)}</small></summary><p>${esc(c.notes ?? c.error ?? "測定待ち")}</p><p>${evidenceLinks(c)}</p><table><thead><tr><th>主張</th><th>段階</th><th>判定</th><th>根拠</th></tr></thead><tbody>${c.claims.map((q) => `<tr><td>${q.id} ${esc(q.text)}</td><td>${q.stage}</td><td>${q.label}</td><td>${esc(q.reason)}<br><small>${esc(q.evidence)}</small></td></tr>`).join("")}</tbody></table></details>`,
  )
  .join("");
write(
  "report.html",
  `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>4人×15キャラクター 実API評価</title><style>body{margin:0;background:#f3f5f7;color:#16222e;font:16px/1.8 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.4}h2{margin-top:44px}p{max-width:950px}a{color:#096b85}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{padding:10px;border-bottom:1px solid #dce3e8;text-align:left;vertical-align:top}th{background:#e8eef2}small{color:#506473}section,.case{margin:16px 0}summary{cursor:pointer;background:white;padding:16px;border-radius:8px}.case>p{padding:0 16px}.case td:first-child{width:38%}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metric{background:white;padding:20px 26px;border-radius:10px}.metric b{display:block;font-size:32px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}.grid img{height:420px;object-fit:cover;object-position:top}img{width:100%;border:1px solid #dce3e8}input,select{padding:10px;font:inherit}svg{max-width:100%;background:white}.note{background:#e7eff4;padding:20px;border-left:4px solid #156f8a}@media(max-width:700px){main{padding:20px 12px}.grid{grid-template-columns:1fr}table{font-size:12px}th,td{padding:5px}h1{font-size:25px}}@media print{details{display:block}summary{break-after:avoid}.filters{display:none}}</style><main><p>CHARACTER TASTE LAB · LIVE EVALUATION</p><h1>4人×15キャラクター<br>実OpenAI APIによる登録・精度評価</h1><p class="note">${esc(result.method)} 状態: ${finalRequested ? "完了" : "実施中"}。</p>${narrative.paragraphs.map((x) => `<p>${esc(x)}</p>`).join("")}<div class="metrics"><div class="metric"><b>${overall.complete}/60</b>初回解析・集計完了</div><div class="metric"><b>${percent(overall.recall)}</b>期待要素抽出率</div><div class="metric"><b>${percent(overall.supportRate)}</b>好み出力の根拠支持率</div><div class="metric"><b>${overall.evaluated}/60</b>意味評価対象</div></div><h2>人物別の結果</h2>${htmlTable}<p>青: 期待要素抽出率 / 茶: 根拠支持率。両指標の分母は異なる。部分一致・未確認を成功には加算しない。</p><svg viewBox="0 0 560 240" role="img" aria-label="人物別の抽出率と支持率">${bars}</svg><h2>条件・使用量</h2><p>通常版・開発DB・全員ベーシック。モデル ${esc(usage.requestedModels.join(", ") || "集計待ち")}、effort未指定。実行記録 ${usage.recordedAppModelCalls}件、input tokens ${usage.inputTokens ?? "不明"}、output tokens ${usage.outputTokens ?? "不明"}。</p><p>訂正検証のモデル呼出 ${usage.correctionModelCalls}件、条件外予備実行 ${usage.excludedOrOtherCalls}件は初回と別集計。</p><p>${esc(usage.note)}</p><h2>累積プロフィールの評価</h2>${profileHtml}<h2>代表画面</h2><div class="grid">${screenshots}</div><h2>60件の記録・主張単位の採点</h2><div class="filters"><label>人物 <select id="persona"><option value="">全員</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label> <label>検索 <input id="query" placeholder="ケースID・キャラクター・作品"></label></div>${detailHtml}<h2>訂正検証と資料</h2><p>${esc(correctionPlan?.deviation ?? "")}</p>${correctionHtml}<p><a href="correction-results.md">初回・再生成・訂正の比較</a></p><p>${corrections.map((c) => `${c.caseId}: ${esc(c.verification?.finalStatus ?? "未完了")}`).join(" / ") || "初回測定後に実施"}</p><p><a href="report.md">報告書Markdown</a> · <a href="issues.md">問題一覧</a> · <a href="research.md">事前調査</a> · <a href="evaluation.csv">評価CSV</a> · <a href="verification-guide.md">確認手順</a></p><h2>評価の限界</h2>${narrative.limitations.map((x) => `<p>${esc(x)}</p>`).join("")}<p>合成4人の単一実行であり、実利用者の満足度や年代・属性集団の傾向、厳密な再現性は評価しない。確認できない作品の細部は確認不能とする。同じモデル系列による採点補助には誤りの相関があり、Codexの再点検も人による独立評価を代替しない。</p><small>データ SHA-256: ${result.datasetHash}<br>生成 ${result.generatedAt}</small></main><script>function filter(){const p=document.querySelector('#persona').value;const q=document.querySelector('#query').value.toLowerCase();document.querySelectorAll('.case').forEach(c=>{c.hidden=(p&&c.dataset.persona!==p)||!c.dataset.search.toLowerCase().includes(q)})}document.querySelector('#persona').addEventListener('change',filter);document.querySelector('#query').addEventListener('input',filter)</script></html>`,
);
console.log(`Report: ${overall.complete}/60 complete, ${overall.evaluated} graded, ${overall.codexReviewed} reviewed`);
