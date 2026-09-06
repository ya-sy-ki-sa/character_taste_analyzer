import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { compareRuns, compareSubsetRuns, summarizeCorrections } from "../evaluation/live-personas/comparison.mjs";
import { digest, readJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--baseline", "--current", "--output", "--cases"].includes(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error("Usage: --baseline RUN_DIR --current RUN_DIR --output NEW_DIRECTORY");
  options[args[i]] = args[i + 1];
}
if (!["--baseline", "--current", "--output"].every((key) => options[key]))
  throw new Error("Usage: --baseline RUN_DIR --current RUN_DIR --output NEW_DIRECTORY");
const baselineRoot = realpathSync(options["--baseline"]);
const currentRoot = realpathSync(options["--current"]);
const requestedOutput = resolve(options["--output"]);
if (existsSync(requestedOutput)) throw new Error("Comparison output already exists; refusing to overwrite");
// Resolve existing parents so a symlink cannot redirect output into the old run.
let parent = dirname(requestedOutput);
while (!existsSync(parent)) parent = dirname(parent);
const output = resolve(realpathSync(parent), relative(parent, requestedOutput));
const inside = (root, path) => {
  const diff = relative(root, path);
  return diff === "" || (diff !== ".." && !diff.startsWith(`..${sep}`) && !isAbsolute(diff));
};
if (baselineRoot === currentRoot || inside(baselineRoot, output))
  throw new Error("Baseline is read-only and must differ from current run");
const read = (root, name) => readJson(`${root}/${name}`);
for (const root of [baselineRoot, currentRoot]) {
  const manifest = read(root, "dataset-manifest.json");
  if (digest(read(root, "dataset.json")) !== manifest.sha256) throw new Error("Dataset manifest mismatch");
}
const result = (options["--cases"] ? compareSubsetRuns : compareRuns)(
  read(baselineRoot, "evaluation.json"),
  read(currentRoot, "evaluation.json"),
  read(baselineRoot, "dataset.json"),
  read(currentRoot, "dataset.json"),
  { baseline: read(baselineRoot, "runtime-settings.json"), current: read(currentRoot, "runtime-settings.json") },
  options["--cases"]?.split(","),
);
if (options["--cases"]) {
  const ids = new Set(options["--cases"].split(","));
  for (const [label, root] of [
    ["baseline", baselineRoot],
    ["current", currentRoot],
  ]) {
    const all = readJson(`${root}/model-runs.json`, null);
    if (!Array.isArray(all)) continue;
    const rows = all.filter((item) => item.phase === "baseline" && ids.has(item.caseId));
    result.usage[label] = {
      recordedAppModelCalls: rows.length,
      inputTokens: rows.some((r) => r.input_token_estimate != null)
        ? rows.reduce((n, r) => n + (r.input_token_estimate ?? 0), 0)
        : null,
      outputTokens: rows.some((r) => r.output_token_estimate != null)
        ? rows.reduce((n, r) => n + (r.output_token_estimate ?? 0), 0)
        : null,
      missingTokenRows: rows.filter((r) => r.input_token_estimate == null || r.output_token_estimate == null).length,
    };
  }
}
const findings = readJson(`${currentRoot}/comparison-findings.json`, null);
const supplementary = readJson(`${currentRoot}/supplementary-review.json`, null);
result.findings = findings;
result.supplementary = supplementary;
const correctionSummary = (root) => {
  const audit = readJson(`${root}/correction-results.json`, null);
  return audit?.records ? summarizeCorrections(audit.records) : null;
};
result.corrections = { baseline: correctionSummary(baselineRoot), current: correctionSummary(currentRoot) };
result.detailedUsage = readJson(`${currentRoot}/usage-comparison.json`, null);
result.methodHashes = Object.fromEntries(
  [
    ["baseline", baselineRoot],
    ["current", currentRoot],
  ].map(([key, root]) => [key, readJson(`${root}/grading-v2/method.json`, null)?.promptHash ?? null]),
);
if (result.methodHashes.baseline !== result.methodHashes.current)
  throw new Error("Grading methods differ; do not report an equivalent comparison");
const esc = (x) =>
  String(x ?? "—")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const rate = (x) => `${x.numerator}/${x.denominator} (${pct(x.rate)})`;
const delta = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} pt`);
const url = (root, path) => relative(output, resolve(root, path)).split("/").map(encodeURIComponent).join("/");
const link = (root, path, label) =>
  existsSync(`${root}/${path}`) ? `[${label}](${url(root, path)})` : `${label}: 未取得`;
const caseEvidence = (root, id) =>
  ["preference-before.json", "failure-0.json", "submission-error.json"].find((name) =>
    existsSync(`${root}/cases/${id}/${name}`),
  ) ?? "preference-before.json";
const caseLinks = (render, root, id, label) => {
  const captured = ["scope-confirmed.png", "preference-confirmed.png"].find((name) =>
    existsSync(`${root}/cases/${id}/${name}`),
  );
  return `${render(root, `cases/${id}/${caseEvidence(root, id)}`, label)} / ${render(root, `cases/${id}/${captured ?? "review-before.png"}`, `${label}${captured ? "・初回確認後" : "・初回"}画面`)}`;
};
const metricLines = (group) =>
  [
    ["解析・集計完了", "completion"],
    ["再試行前の完了", "firstPass"],
    ["期待要素抽出", "recall"],
    ["好みの根拠支持", "support"],
  ].map(
    ([label, key]) =>
      `| ${label} | ${rate(group.baseline[key])} | ${rate(group.current[key])} | ${delta(group.deltaPoints[key])} |`,
  );
const rows = result.rows.map((r) => ({
  caseId: r.caseId,
  personaId: r.personaId,
  character: r.character,
  baselineStatus: r.baselineStatus,
  currentStatus: r.currentStatus,
  baselineCandidates: r.baselineCandidates,
  currentCandidates: r.currentCandidates,
  commonEvaluable: r.commonEvaluable,
  baselineExpectedMatched: r.baseline.recall.numerator,
  baselineExpectedTotal: r.baseline.recall.denominator,
  currentExpectedMatched: r.current.recall.numerator,
  currentExpectedTotal: r.current.recall.denominator,
  recallDeltaPoints: r.deltaPoints.recall,
  baselineSupported: r.baseline.support.numerator,
  baselinePreferenceClaims: r.baseline.support.denominator,
  currentSupported: r.current.support.numerator,
  currentPreferenceClaims: r.current.support.denominator,
  supportDeltaPoints: r.deltaPoints.support,
}));
const summary = findings?.paragraphs ?? ["比較の解釈・既知問題の再点検は未完了。数値は採点済みデータの集計。"];
const issueRows = findings?.issues ?? [];
const structuredRows = Object.entries(supplementary?.structured ?? {});
const retention = (value) => {
  if (!value) return "未評価";
  const label =
    { matched: "保持", partial: "一部保持", missed: "未抽出", not_evaluable: "評価不能" }[value.label] ?? value.label;
  return `${label} / 候補${value.candidateCount ?? "未取得"}件`;
};
const retentionDetail = (value) =>
  value ? [value.reason, value.profileObservation].filter(Boolean).join(" ") || "未評価" : "未評価";
const correctionText = (x) =>
  x
    ? `代表${x.completedRepresentatives}/${x.representatives}件完了、変更${x.mutatedPreferences}候補、根拠あり${x.withEvidence}・なし${x.withoutEvidence}・未取得${x.evidenceNotObserved}、情報不足${x.insufficientAfterCorrection}候補`
    : "未実施・未取得";
const usageRows = [
  ["初回アプリ", (r) => r?.app?.baseline],
  ["訂正・追加再解析アプリ", (r) => r?.app?.correction],
  ["一次採点補助", (r) => r?.gradingPrimary],
  ["別パス採点補助", (r) => r?.gradingSecond],
].map(([label, select]) => {
  const describe = (side) => {
    const x = select(result.detailedUsage?.runs?.[side]);
    return x
      ? `${x.calls}呼出 / input ${x.inputTokens.sum ?? "未取得"}・output ${x.outputTokens.sum ?? "未取得"} tokens / 中央値${x.latencyMs.median ?? "未取得"}・P90 ${x.latencyMs.p90 ?? "未取得"} ms / tokens欠損 ${x.inputTokens.missingRows}/${x.outputTokens.missingRows}行`
      : "未取得";
  };
  return [label, describe("baseline"), describe("current")];
});
const md = [
  "# CHARACTER TASTE LAB · LIVE EVALUATION 再評価比較",
  "",
  `${result.baselineRun} → ${result.currentRun} / 今回の状態: ${result.currentStatus}`,
  "",
  ...summary,
  "",
  `## 対象${result.rows.length}件`,
  "",
  "| 指標 | 前回 | 今回 | 差 |",
  "|---|---:|---:|---:|",
  ...metricLines(result.all),
  "",
  `## 両方で意味評価できた共通${result.common.caseIds.length}件`,
  "",
  "| 指標 | 前回 | 今回 | 差 |",
  "|---|---:|---:|---:|",
  ...metricLines(result.common),
  "",
  "## 構造化候補・プロフィールの保持",
  "",
  "上記の抽出率は要約を含む。以下は測定前に固定した追加基準による候補・条件の評価であり、理由不足の保留例も別行に含む。保持の判定は候補数だけでは決めない。",
  "",
  "| ケース | 前回 | 今回 | 今回の根拠・プロフィール反映 |",
  "|---|---|---|---|",
  ...structuredRows.map(
    ([id, x]) =>
      `| ${id} | ${retention(x.baseline)} | ${retention(x.current)} | ${retentionDetail(x.current).replaceAll("|", "／")} |`,
  ),
  "",
  "## 人物別",
  "",
  "| 人物 | 完了 前→今 | 抽出 前→今 | 支持 前→今 |",
  "|---|---|---|---|",
  ...Object.entries(result.byPersona).map(
    ([id, { all: g }]) =>
      `| ${id} | ${rate(g.baseline.completion)} → ${rate(g.current.completion)} | ${rate(g.baseline.recall)} → ${rate(g.current.recall)} | ${rate(g.baseline.support)} → ${rate(g.current.support)} |`,
  ),
  "",
  "## 既知問題と新規問題",
  "",
  "| 対象 | 判定 | 観測と根拠 |",
  "|---|---|---|",
  ...issueRows.map((x) => `| ${x.caseIds.join(", ")} | ${x.verdict} | ${x.reason.replaceAll("|", "／")} |`),
  "",
  "## 処理量と時間",
  "",
  `初回LLM呼出: ${result.usage.baseline.recordedAppModelCalls ?? "未取得"} → ${result.usage.current.recordedAppModelCalls}。採点補助・訂正は別集計。`,
  `初回input tokens: ${result.usage.baseline.inputTokens ?? "不明"} → ${result.usage.current.inputTokens ?? "不明"}。output tokens: ${result.usage.baseline.outputTokens ?? "不明"} → ${result.usage.current.outputTokens ?? "不明"}。`,
  `登録保存→集計完了の中央値: ${result.timing.baseline.totalSeconds?.median ?? "不明"} → ${result.timing.current.totalSeconds?.median ?? "不明"}秒。P90: ${result.timing.baseline.totalSeconds?.p90 ?? "不明"} → ${result.timing.current.totalSeconds?.p90 ?? "不明"}秒。UI待機を含む。`,
  "",
  "| 工程 | 前回 | 今回 |",
  "|---|---|---|",
  ...usageRows.map((row) => `| ${row.join(" | ")} |`),
  "",
  "## 訂正機能",
  "",
  `前回: ${correctionText(result.corrections.baseline)}。`,
  `今回: ${correctionText(result.corrections.current)}。`,
  "同じ訂正意図を現在の候補へ対応づけたため、追加・更新・不要となった操作の数は異なる。再生成による差は手動訂正の効果へ加算しない。",
  "",
  `## ${result.rows.length}件の対応表`,
  "",
  "| ケース | キャラクター | 完了状態 前→今 | 候補数 前→今 | 原出力 |",
  "|---|---|---|---|---|",
  ...result.rows.map(
    (r) =>
      `| ${r.caseId} | ${r.character} | ${r.baselineStatus} → ${r.currentStatus} | ${r.baselineCandidates ?? "未取得"} → ${r.currentCandidates ?? "未取得"} | ${caseLinks(link, baselineRoot, r.caseId, "前回")} / ${caseLinks(link, currentRoot, r.caseId, "今回")} |`,
  ),
  "",
  "## 資料と限界",
  "",
  ...result.limitations.map((x) => `- ${x}`),
  "",
  `${link(baselineRoot, "report.html", "前回レポート")} / ${link(currentRoot, "report.html", "今回レポート")} / [比較CSV](comparison.csv) / [比較JSON](comparison.json)`,
  `${link(currentRoot, "comparison-protocol.json", "固定した比較基準")} / ${link(currentRoot, "supplementary-review.json", "構造化候補・条件・プロフィールの追加評価")} / ${link(currentRoot, "correction-results.md", "訂正検証")}`,
  "",
];
const metricHtml = (group) =>
  `<table><tr><th>指標</th><th>前回</th><th>今回</th><th>差</th></tr>${[
    ["解析完了", "completion"],
    ["期待要素抽出", "recall"],
    ["好みの根拠支持", "support"],
  ]
    .map(
      ([label, key]) =>
        `<tr><th>${label}</th><td>${rate(group.baseline[key])}</td><td>${rate(group.current[key])}</td><td>${delta(group.deltaPoints[key])}</td></tr>`,
    )
    .join("")}</table>`;
const htmlLink = (root, path, label) =>
  existsSync(`${root}/${path}`) ? `<a href="${esc(url(root, path))}">${esc(label)}</a>` : `${esc(label)}: 未取得`;
const structuredHtml = `<h2>構造化候補・プロフィールの保持</h2><p>上記の抽出率は要約を含む。以下は固定した追加基準による候補・条件の評価。理由不足の保留例は別行に含め、候補数だけでは成功を判定しない。</p><table><tr><th>ケース</th><th>前回</th><th>今回</th><th>今回の根拠・プロフィール反映</th></tr>${structuredRows.map(([id, x]) => `<tr><th>${esc(id)}</th><td>${esc(retention(x.baseline))}</td><td>${esc(retention(x.current))}</td><td>${esc(retentionDetail(x.current))}</td></tr>`).join("")}</table><p>${htmlLink(currentRoot, "comparison-protocol.json", "固定基準")} / ${htmlLink(currentRoot, "supplementary-review.json", "前後の根拠と追加評価")} / ${htmlLink(currentRoot, "profile-retention-evidence.json", "候補とプロフィールの照合")} / ${htmlLink(currentRoot, "correction-results.md", "訂正の結果")} / ${htmlLink(currentRoot, "usage-comparison.json", "採点補助・訂正の使用量")}</p>`;
const additionalHtml = `<div class="scroll"><table><tr><th>工程</th><th>前回</th><th>今回</th></tr>${usageRows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</table></div><h2>訂正機能</h2><p>前回: ${esc(correctionText(result.corrections.baseline))}。</p><p>今回: ${esc(correctionText(result.corrections.current))}。</p><p>同じ訂正意図を現在の候補へ対応づけたため、追加・更新・不要となった操作数は異なる。再生成による差を手動訂正の効果へ加算しない。${htmlLink(currentRoot, "correction-results.md", "操作別の結果と未実施理由")}</p>`;
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LIVE EVALUATION 前回比較</title><style>body{margin:0;background:#f3f5f7;color:#16222e;font:16px/1.8 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px 20px}h1{font-size:28px}h2{margin-top:36px}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{padding:10px;border-bottom:1px solid #dce3e8;text-align:left}th{background:#e8eef2}a{color:#096b85}.scroll{overflow:auto}.shots{display:grid;grid-template-columns:1fr 1fr;gap:16px}.shots img{width:100%;max-height:500px;object-fit:contain;object-position:top}figure{margin:0}input,select{padding:8px;font:inherit}@media(max-width:700px){.shots{grid-template-columns:1fr}main{padding:20px 12px}td,th{padding:6px}}</style><main><p>CHARACTER TASTE LAB · LIVE EVALUATION</p><h1>同じ${result.rows.length}件による再評価と前回比較</h1><p>${esc(result.baselineRun)} → ${esc(result.currentRun)} / ${esc(result.currentStatus)}</p>${summary.map((x) => `<p>${esc(x)}</p>`).join("")}<h2>対象${result.rows.length}件</h2>${metricHtml(result.all)}<h2>両方で意味評価できた共通${result.common.caseIds.length}件</h2>${metricHtml(result.common)}${structuredHtml}<h2>人物別</h2><div class="scroll"><table><tr><th>人物</th><th>完了 前→今</th><th>抽出 前→今</th><th>支持 前→今</th></tr>${Object.entries(
  result.byPersona,
)
  .map(
    ([id, { all: g }]) =>
      `<tr><th>${id}</th><td>${rate(g.baseline.completion)} → ${rate(g.current.completion)}</td><td>${rate(g.baseline.recall)} → ${rate(g.current.recall)}</td><td>${rate(g.baseline.support)} → ${rate(g.current.support)}</td></tr>`,
  )
  .join(
    "",
  )}</table></div><h2>処理量と時間</h2><p>初回LLM呼出: ${result.usage.baseline.recordedAppModelCalls ?? "未取得"} → ${result.usage.current.recordedAppModelCalls ?? "未取得"}。input tokens: ${result.usage.baseline.inputTokens ?? "未取得"} → ${result.usage.current.inputTokens ?? "未取得"}。output tokens: ${result.usage.baseline.outputTokens ?? "未取得"} → ${result.usage.current.outputTokens ?? "未取得"}。</p><p>登録保存から集計完了までの中央値: ${result.timing.baseline.totalSeconds?.median ?? "未取得"} → ${result.timing.current.totalSeconds?.median ?? "未取得"}秒。P90: ${result.timing.baseline.totalSeconds?.p90 ?? "未取得"} → ${result.timing.current.totalSeconds?.p90 ?? "未取得"}秒。UI待機を含む。採点補助・訂正は別集計。</p>${additionalHtml}<h2>既知問題と新規問題</h2><table><tr><th>対象</th><th>判定</th><th>根拠</th></tr>${issueRows.map((x) => `<tr><td>${esc(x.caseIds.join(", "))}</td><td>${esc(x.verdict)}</td><td>${esc(x.reason)}</td></tr>`).join("")}</table><h2>${result.rows.length}件の対応表</h2><p><label>人物 <select id="persona"><option value="">全員</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label> <label>検索 <input id="query" placeholder="ケース・キャラクター・作品"></label></p><div class="scroll"><table><tr><th>ケース</th><th>キャラクター</th><th>状態 前→今</th><th>候補数 前→今</th><th>抽出率 前→今</th><th>支持率 前→今</th><th>原出力</th></tr>${result.rows.map((r) => `<tr class="case" data-persona="${esc(r.personaId)}" data-search="${esc(`${r.caseId} ${r.character} ${r.work}`.toLowerCase())}"><th>${r.caseId}</th><td>${esc(r.character)}</td><td>${r.baselineStatus} → ${r.currentStatus}</td><td>${r.baselineCandidates ?? "—"} → ${r.currentCandidates ?? "—"}</td><td>${pct(r.baseline.recall.rate)} → ${pct(r.current.recall.rate)}</td><td>${pct(r.baseline.support.rate)} → ${pct(r.current.support.rate)}</td><td>${caseLinks(htmlLink, baselineRoot, r.caseId, "前回")} / ${caseLinks(htmlLink, currentRoot, r.caseId, "今回")}</td></tr>`).join("")}</table></div><h2>プロフィール画面（部分集合では累積値を直接比較しない）</h2>${Object.keys(
  result.byPersona,
)
  .map(
    (id) =>
      `<h3>${id}</h3><div class="shots">${[
        ["前回", baselineRoot],
        ["今回", currentRoot],
      ]
        .map(([label, root]) => {
          const stage = root === currentRoot && result.selection ? "subset-final" : "15";
          const path = `profiles/${id}/${stage}.png`;
          const caption = `${label}：${stage === "15" ? "15件時点" : "選択ケース登録後"}`;
          return existsSync(`${root}/${path}`)
            ? `<figure><a href="${esc(url(root, path))}"><img loading="lazy" src="${esc(url(root, path))}" alt="${id} ${caption}"></a><figcaption>${caption}</figcaption></figure>`
            : `<p>${label}: 未取得</p>`;
        })
        .join("")}</div>`,
  )
  .join(
    "",
  )}<h2>資料と限界</h2>${result.limitations.map((x) => `<p>${esc(x)}</p>`).join("")}<p><a href="comparison.md">比較報告書</a> / <a href="comparison.csv">CSV</a> / <a href="comparison.json">JSON</a> / ${htmlLink(baselineRoot, "report.html", "前回レポート")} / ${htmlLink(currentRoot, "report.html", "今回レポート")}</p></main><script>function filter(){const p=document.querySelector('#persona').value,q=document.querySelector('#query').value.toLowerCase();document.querySelectorAll('.case').forEach(c=>{c.hidden=Boolean(p&&c.dataset.persona!==p)||!c.dataset.search.includes(q)})}document.querySelector('#persona').addEventListener('change',filter);document.querySelector('#query').addEventListener('input',filter)</script></html>`;
mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (name, value) => writeFileSync(`${output}/${name}`, value, { flag: "wx", mode: 0o600 });
write("comparison.json", `${JSON.stringify(result, null, 2)}\n`);
write("comparison.md", `${md.join("\n")}\n`);
write("comparison.html", html);
const keys = Object.keys(rows[0] ?? {});
write(
  "comparison.csv",
  `${[keys, ...rows.map((r) => keys.map((k) => r[k]))].map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`,
);
console.log(`Comparison written: ${output} (${result.common.caseIds.length} common cases)`);
