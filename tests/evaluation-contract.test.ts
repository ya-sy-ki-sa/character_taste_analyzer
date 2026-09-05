import { beforeAll, describe, expect, it } from "vitest";
import { qualityCases } from "../evaluation/cases";
import { qualityMetrics } from "../evaluation/metrics";
import { caseFailed, type QualityReport, qualityReportSchema } from "../evaluation/report";
import { runQualityEvaluation } from "../evaluation/run";
import type { Env } from "../worker/types";

let report: QualityReport;
beforeAll(async () => {
  const only = [
    qualityCases.find((item) => item.domain === "standard" && !item.expectsEmpty),
    qualityCases.find((item) => item.domain === "dark" && !item.expectsEmpty),
    qualityCases.find((item) => item.expectsEmpty),
  ].map((item) => {
    if (!item) throw new Error("Required evaluation fixture is missing");
    return item.id;
  });
  report = await runQualityEvaluation(
    {
      ENVIRONMENT: "local",
      AUTH_PEPPER: "evaluation-contract-fixture",
      LLM_PROVIDER: "fake",
      LLM_MODEL: "fake-v1",
      EMBEDDING_PROVIDER: "fake",
      EMBEDDING_MODEL: "fake",
      MODERATION_PROVIDER: "fake",
    } as Env,
    only.length,
    { only, generate: true },
  );
});
describe("current evaluation output", () => {
  it("validates actual normal/dark results and records generation skips", () => {
    expect(report.results).toHaveLength(3);
    expect(report.results.some(caseFailed)).toBe(false);
    expect(report.results.some((item) => !("error" in item) && item.generation)).toBe(true);
    expect(report.results.some((item) => !("error" in item) && item.generationSkippedReason)).toBe(true);
  });
  it("counts a generation failure as a failed case", () => {
    const failed = structuredClone(report);
    const result = failed.results.find((item) => !("error" in item) && item.generation);
    if (!result || "error" in result || !result.generation) throw new Error("Expected generated fixture");
    result.generation.result.status = "failed";
    expect(caseFailed(result)).toBe(true);
    expect(qualityMetrics(failed).completedCases).toBe(2);
  });
  it("counts an analysis error as a failed case", () => {
    const failed = structuredClone(report);
    failed.results[0] = { id: failed.results[0].id, domain: "standard", error: "EVALUATION_FAILED", jobs: [] };
    expect(qualityMetrics(failed).completedCases).toBe(2);
  });
  it("rejects missing generation outcomes and obsolete report formats", () => {
    expect(qualityReportSchema.safeParse({ ...report, schemaVersion: "1.0" }).success).toBe(false);
    const missing = structuredClone(report);
    const result = missing.results.find((item) => !("error" in item) && item.generation);
    if (!result || "error" in result) throw new Error("Expected generated fixture");
    result.generation = null;
    expect(qualityReportSchema.safeParse(missing).success).toBe(false);
  });
  it("leaves unmeasured accuracy, correction and adoption metrics unknown", () => {
    const empty = report.results.filter((item) => !("error" in item) && item.expectsEmpty);
    expect(qualityMetrics({ results: empty })).toMatchObject({
      expectedChannelRecall: null,
      attributableEvidenceRate: null,
      userCorrectionRate: null,
      userAdoptionRate: null,
    });
  });
});
