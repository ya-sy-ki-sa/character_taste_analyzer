import { readFile } from "node:fs/promises";

const path = process.argv[2] || "eval/dataset.example.jsonl";
const content = await readFile(path, "utf8");
const cases = content
  .split(/\r?\n/u)
  .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
  .map((line) => JSON.parse(line));

if (!cases.length) throw new Error("評価ケースがありません");

const totals = {
  cases: cases.length,
  doubleLabeled: 0,
  structured: 0,
  grounded: 0,
  displayed: 0,
  unsupported: 0,
  generationChecks: 0,
  generationPassed: 0,
};
const traitStats = new Map();

for (const item of cases) {
  if (item.review?.labelerA && item.review?.labelerB && item.review?.adjudicated === true) totals.doubleLabeled += 1;
  if (item.run?.structuredOutputSucceeded === true) totals.structured += 1;
  const gold = new Set(item.gold?.traitIds || []);
  const predicted = new Set();
  for (const assertion of item.prediction?.assertions || []) {
    predicted.add(assertion.traitId);
    totals.displayed += 1;
    const source = item.source?.[assertion.evidence?.field];
    if (typeof source === "string" && source.includes(assertion.evidence?.quote || "\u0000")) totals.grounded += 1;
    if (!gold.has(assertion.traitId)) totals.unsupported += 1;
  }
  for (const traitId of new Set([...gold, ...predicted])) {
    const stats = traitStats.get(traitId) || { tp: 0, fp: 0, fn: 0 };
    if (gold.has(traitId) && predicted.has(traitId)) stats.tp += 1;
    else if (predicted.has(traitId)) stats.fp += 1;
    else stats.fn += 1;
    traitStats.set(traitId, stats);
  }
  if (item.generation) {
    totals.generationChecks += 1;
    const used = new Set(item.generation.usedTraitIds || []);
    const required = item.generation.requiredTraitIds || [];
    const forbidden = item.generation.forbiddenTraitIds || [];
    if (
      required.every((id) => used.has(id)) &&
      forbidden.every((id) => !used.has(id)) &&
      item.generation.safetyPassed === true
    ) {
      totals.generationPassed += 1;
    }
  }
}

const macroF1 =
  [...traitStats.values()].reduce((sum, { tp, fp, fn }) => {
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    return sum + (precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
  }, 0) / Math.max(1, traitStats.size);

const ratio = (value, denominator) => (denominator ? value / denominator : 1);
const metrics = {
  caseCount: totals.cases,
  doubleLabeledCount: totals.doubleLabeled,
  structuredOutputSuccessRate: ratio(totals.structured, totals.cases),
  evidenceReferenceIntegrity: ratio(totals.grounded, totals.displayed),
  unsupportedTraitRate: ratio(totals.unsupported, totals.displayed),
  macroF1,
  generationComplianceRate: ratio(totals.generationPassed, totals.generationChecks),
};
const gates = {
  humanDatasetReady: metrics.caseCount >= 200 && metrics.doubleLabeledCount === metrics.caseCount,
  structuredOutput: metrics.structuredOutputSuccessRate >= 0.99,
  evidenceIntegrity: metrics.evidenceReferenceIntegrity === 1,
  unsupportedTraits: metrics.unsupportedTraitRate < 0.02,
  extractionF1: metrics.macroF1 >= 0.85,
  generationCompliance: metrics.generationComplianceRate >= 0.99,
};

console.log(JSON.stringify({ dataset: path, metrics, gates, passed: Object.values(gates).every(Boolean) }, null, 2));
if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
