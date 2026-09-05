import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { cases, personas, rubric, sources } from "../evaluation/live-personas/dataset.mjs";
import { digest, preserveJson, readJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
const server = await createServer({
  configFile: false,
  cacheDir: "node_modules/.vite-live-fixtures",
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
try {
  const { entrySubmissionSchema } = await server.ssrLoadModule("/shared/contracts/entries.ts");
  if (cases.length !== 60) throw new Error("Expected 60 cases");
  for (const p of personas) {
    const selected = cases.filter((c) => c.personaId === p.id);
    if (selected.length !== 15 || new Set(selected.map((c) => c.characterKey)).size !== 15)
      throw new Error("Invalid persona count");
    for (const kind of ["short", "natural", "detailed"])
      if (selected.filter((c) => c.lengthClass === kind).length !== { short: 3, natural: 9, detailed: 3 }[kind])
        throw new Error("Invalid input distribution");
    const works = selected.map((c) => c.input.workTitle);
    if (works.some((w) => works.filter((x) => x === w).length > 3)) throw new Error("Work concentration");
  }
  for (const c of cases) {
    entrySubmissionSchema.parse(c.input);
    for (const id of c.research.sourceIds) if (!sources[id]) throw new Error(`Unknown source ${id}`);
  }
  const dataset = { schemaVersion: "persona-live/v1", personas, sources, rubric, cases };
  const hash = digest(dataset);
  const old = readJson(`${root}/dataset.json`, null);
  if (old && digest(old) !== hash) throw new Error("Frozen dataset differs; use a new run directory");
  preserveJson(`${root}/dataset.json`, dataset);
  preserveJson(`${root}/dataset-manifest.json`, {
    sha256: hash,
    frozenAt: new Date().toISOString(),
    cases: 60,
    review: "Codex checked source scope, counts, input evidence, media and synthetic timeline before live calls",
  });
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")).vars;
  process.loadEnvFile(".dev.vars");
  const safeKeys = [
    "ENVIRONMENT",
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
    "APP_ORIGIN",
  ];
  preserveJson(
    `${root}/runtime-settings.json`,
    Object.fromEntries(safeKeys.map((k) => [k, process.env[k] ?? config[k] ?? null])),
  );
  mkdirSync(root, { recursive: true });
  const lines = [
    "# 事前調査・固定入力",
    "",
    "架空ユーザーとCodex作成の入力。出典の短い要約は採点専用で、アプリに送信しない。",
    `固定ハッシュ: ${hash}`,
    "",
    ...personas.flatMap((p) => [
      `## ${p.label} ${p.name}`,
      p.background,
      "",
      ...cases
        .filter((c) => c.personaId === p.id)
        .flatMap((c) => [
          `### ${c.id} ${c.input.characterName} — ${c.input.workTitle}`,
          `媒体・範囲: ${c.input.mediaType} / ${c.input.preferenceContext}`,
          `入力: ${c.input.preference.likedReasons}`,
          c.input.preference.dislikedReasons ? `苦手: ${c.input.preference.dislikedReasons}` : "",
          c.input.userCharacterView ?? "",
          `期待: ${c.gold.expected.map((x) => x.concept).join(" / ") || "根拠不足として保留"}`,
          `出典: ${c.research.sourceIds.map((id) => `[${id}](${sources[id].url})`).join("、")}`,
          "",
        ]),
    ]),
    "## 出典確認記録",
    ...Object.entries(sources).flatMap(([id, s]) => [
      `### ${id}`,
      `[確認資料](${s.url}) / ${s.accessedOn}`,
      s.facts,
      `制限: ${s.limitation}`,
      "",
    ]),
  ];
  writeFileSync(`${root}/research.md`, lines.join("\n"), { mode: 0o600 });
  console.log(`Frozen ${cases.length} cases: ${hash}`);
} finally {
  await server.close();
}
