import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const output = option("--output");
if (!output)
  throw new Error(
    "Usage: npm run eval:quality -- --output <report.json> [--provider fake|openai] [--limit 4] [--compare baseline.json]",
  );
if (existsSync(output)) throw new Error("Evaluation output already exists; choose a new path to preserve the baseline");
const provider = option("--provider", "fake");
if (!["fake", "openai"].includes(provider)) throw new Error("Evaluation supports explicit fake or openai providers");
const vars = JSON.parse(readFileSync("wrangler.jsonc", "utf8")).vars;
if (provider === "openai" && existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
const env = {
  ...vars,
  ...process.env,
  LLM_PROVIDER: provider,
  LLM_MODEL: provider === "fake" ? "fake-v1" : option("--model", vars.LLM_MODEL),
  AUTH_PEPPER: "quality-evaluation-synthetic-data",
  MODERATION_PROVIDER: "fake",
  EMBEDDING_PROVIDER: option("--embedding-provider", "fake"),
};
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
try {
  const { runQualityEvaluation } = await server.ssrLoadModule("/worker/evaluation/run.ts");
  const paths = (root) =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? paths(`${root}/${entry.name}`)
        : /\.(ts|sql)$/u.test(entry.name)
          ? [`${root}/${entry.name}`]
          : [],
    );
  const sourceHashes = Object.fromEntries(
    ["worker", "shared", "scripts/lib", "docs/詳細設計/database"]
      .flatMap(paths)
      .sort()
      .map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]),
  );
  const limit = Number(option("--limit", "67"));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 67) throw new Error("limit must be between 1 and 67");
  const report = await runQualityEvaluation(env, limit, {
    generate: args.includes("--generate"),
    only: option("--only", "").split(",").filter(Boolean),
  });
  if (!report.results.length) throw new Error("No matching evaluation fixtures");
  const { qualityMetrics, compareQualityReports } = await server.ssrLoadModule("/worker/evaluation/metrics.ts");
  report.metrics = qualityMetrics(report);
  report.gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  report.sourceHashes = sourceHashes;
  const compare = option("--compare");
  if (compare) {
    const baseline = JSON.parse(readFileSync(compare, "utf8"));
    if (
      baseline.fixtureVersion !== report.fixtureVersion ||
      baseline.model !== report.model ||
      baseline.provider !== report.provider
    )
      throw new Error("Baseline fixture version and model must match");
    report.comparison = compareQualityReports(baseline, report);
    report.baseline = { path: compare, sha256: createHash("sha256").update(readFileSync(compare)).digest("hex") };
  }
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Quality evaluation saved: ${output} (${report.results.length} cases)`);
  if (
    report.results.some(
      (result) =>
        result.error || (result.generation?.result?.status && result.generation.result.status !== "generated"),
    )
  )
    process.exitCode = 1;
} finally {
  await server.close();
}
