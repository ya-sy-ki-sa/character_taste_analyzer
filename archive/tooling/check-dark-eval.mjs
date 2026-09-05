import { readFile } from "node:fs/promises";

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error("Usage: npm run eval:dark:gate -- <evaluation-report.json>");
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const failures = [];
const requireAtLeast = (label, actual, minimum) => {
  if (!Number.isFinite(actual) || actual < minimum) failures.push(`${label}: ${String(actual)} < ${minimum}`);
};
const requireAtMost = (label, actual, maximum) => {
  if (!Number.isFinite(actual) || actual > maximum) failures.push(`${label}: ${String(actual)} > ${maximum}`);
};

requireAtLeast("fixtureCount", report.fixtureCount, 48);
requireAtLeast("eligibility.macroF1", report.metrics?.eligibility?.macroF1, 0.92);
requireAtLeast("eligibility.inScopeRecall", report.metrics?.eligibility?.inScopeRecall, 0.95);
for (const dimension of ["agency", "state", "relationship", "morality", "transformationDelta"]) {
  requireAtLeast(`extraction.${dimension}.macroF1`, report.metrics?.extraction?.[dimension]?.macroF1, 0.87);
}
requireAtLeast("preference.precision", report.metrics?.preference?.precision, 0.92);
requireAtLeast("evidence.referenceAccuracy", report.metrics?.evidence?.referenceAccuracy, 1);
requireAtMost("critical.semanticConfusions", report.metrics?.critical?.semanticConfusions, 0);
requireAtMost("critical.unnecessaryMoralization", report.metrics?.critical?.unnecessaryMoralization, 0);
requireAtLeast(
  "commonMacroF1 improvement",
  (report.metrics?.comparison?.currentCommonMacroF1 ?? Number.NaN) -
    (report.metrics?.comparison?.recordedBaselineCommonMacroF1 ?? Number.NaN),
  0.05,
);

if (failures.length) {
  throw new Error(`Dark analyzer release gate failed:\n- ${failures.join("\n- ")}`);
}
console.log(`Dark analyzer release gate OK: ${report.fixtureCount} fixtures (${report.model ?? "unknown model"})`);
