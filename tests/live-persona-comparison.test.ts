import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error JS evaluation module
import * as comparison from "../evaluation/live-personas/comparison.mjs";
// @ts-expect-error JS evaluation module
import { selectDataset } from "../evaluation/live-personas/selection.mjs";
// @ts-expect-error JS evaluation module
import { digest, liveRunRoot } from "../evaluation/live-personas/storage.mjs";

const { compareRuns, compareSubsetRuns, summarizeCases, summarizeCorrections } = comparison;
const dataset = { personas: [{ id: "A" }], cases: [{ id: "A01" }, { id: "A02" }, { id: "A03" }] };
const settings = { LLM_MODEL: "test-model" };
function record(caseId: string, status = "complete", label = "matched", supported = true) {
  const available = status === "complete";
  return {
    caseId,
    personaId: "A",
    character: caseId,
    work: "fixture",
    status,
    retries: 0,
    codexReviewed: true,
    expected: [{ id: "E1", label: available ? label : "not_evaluable" }],
    claims: available ? [{ stage: "preference", text: caseId, label: supported ? "supported" : "contradicted" }] : [],
    metrics: { structuredPreferenceCount: available ? 1 : null },
  };
}
function run(records = [record("A01"), record("A02"), record("A03")]) {
  return {
    runId: "fixture",
    status: "complete",
    datasetHash: digest(dataset),
    records,
    usage: { requestedModels: ["test-model"], responseModels: ["test-model"] },
    timingSummary: {},
  };
}
const compare = (baseline: ReturnType<typeof run>, current: ReturnType<typeof run>) =>
  compareRuns(baseline, current, dataset, dataset, { baseline: settings, current: settings });

describe("live persona comparison", () => {
  it("shows both changing denominators and the common evaluated cohort", () => {
    const before = run([record("A01"), record("A02", "failed"), record("A03", "complete", "partial", false)]);
    const after = run([record("A01"), record("A02"), record("A03", "failed")]);
    const result = compare(before, after);
    expect(result.all.baseline.recall).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.all.current.recall).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(result.all.deltaPoints.recall).toBe(50);
    expect(result.common.caseIds).toEqual(["A01"]);
    expect(result.common.deltaPoints.recall).toBe(0);
    expect(result.rows[1].baselineCandidates).toBeNull();
  });
  it("does not double count repeated claims within a case or merge different cases", () => {
    const a = record("A01");
    a.claims.push({ ...a.claims[0] });
    const b = record("A02");
    b.claims[0].text = "A01";
    expect(summarizeCases([a, b]).support).toEqual({ numerator: 2, denominator: 2, rate: 1 });
  });
  it("keeps missing, failed, partial and unevaluable results out of the success numerator", () => {
    const result = compare(
      run(),
      run([record("A01", "held"), record("A02", "failed"), record("A03", "submission_failed")]),
    );
    expect(result.all.current.recall.rate).toBeNull();
    expect(result.all.current.support.rate).toBeNull();
    expect(result.all.current.completion.rate).toBe(0);
    expect(result.common.caseIds).toEqual([]);
    expect(result.common.deltaPoints.support).toBeNull();
  });
  it("rejects changed inputs, case order, model settings and unaudited grades", () => {
    expect(() => compare(run(), { ...run(), datasetHash: "other" })).toThrow("DATASET_MISMATCH");
    expect(() => compare(run(), run([record("A02"), record("A01"), record("A03")]))).toThrow("DATASET_MISMATCH");
    expect(() =>
      compareRuns(run(), run(), dataset, dataset, { baseline: settings, current: { LLM_MODEL: "other" } }),
    ).toThrow("SETTINGS_MISMATCH");
    const unreviewed = run();
    unreviewed.records[0].codexReviewed = false;
    expect(() => compare(run(), unreviewed)).toThrow("REQUIRES_REVIEWED");
    const wrongModel = run();
    wrongModel.usage.responseModels = ["other"];
    expect(() => compare(run(), wrongModel)).toThrow("ACTUAL_MODEL_MISMATCH");
  });
  it("derives correction evidence totals from observations, including unavailable operations", () => {
    const result = summarizeCorrections([
      {
        caseId: "A07",
        finalStatus: "active",
        preferenceOperations: [
          { action: "update", finalEvidenceCount: 1, dimension: { classification: "emerging" } },
          { action: "add", finalEvidenceCount: 0, dimension: { classification: "insufficient" } },
          { action: "reject" },
        ],
      },
      { caseId: "B02", finalStatus: "failed", preferenceOperations: [] },
      { caseId: "C11", finalStatus: "active", preferenceOperations: [{ action: "add", finalEvidenceCount: null }] },
    ]);
    expect(result).toMatchObject({
      representatives: 3,
      completedRepresentatives: 2,
      unavailableRepresentatives: ["B02"],
      mutatedPreferences: 3,
      withEvidence: 1,
      withoutEvidence: 1,
      evidenceNotObserved: 1,
      insufficientAfterCorrection: 1,
    });
    expect(summarizeCorrections([]).mutatedPreferences).toBe(0);
  });
  it("requires an explicit writable run and protects finalized evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-root-"));
    try {
      expect(() => liveRunRoot("")).toThrow("LIVE_RUN_DIR is required");
      expect(liveRunRoot(dir)).toBe(dir);
      writeFileSync(join(dir, "final-artifact-manifest.json"), "{}");
      expect(() => liveRunRoot(dir)).toThrow("read-only");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("writes new comparison artifacts while refusing baseline and existing output paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-comparison-cli-"));
    const before = join(dir, "baseline");
    const after = join(dir, "current");
    const output = join(after, "comparison");
    const write = (root: string, name: string, value: unknown) =>
      writeFileSync(join(root, name), JSON.stringify(value));
    const cli = (destination: string) =>
      execFileSync(
        process.execPath,
        ["scripts/compare-live-personas.mjs", "--baseline", before, "--current", after, "--output", destination],
        { stdio: "pipe" },
      );
    try {
      for (const root of [before, after]) {
        mkdirSync(root, { recursive: true });
        mkdirSync(join(root, "grading-v2"));
        write(root, "dataset.json", dataset);
        write(root, "dataset-manifest.json", { sha256: digest(dataset) });
        write(root, "evaluation.json", run());
        write(root, "runtime-settings.json", settings);
        write(root, "grading-v2/method.json", { promptHash: "same" });
      }
      write(
        after,
        "evaluation.json",
        run([record("A01"), record("A02", "complete", "partial", false), record("A03", "failed")]),
      );
      mkdirSync(join(after, "cases/A03"), { recursive: true });
      write(after, "cases/A03/failure-0.json", { error: "fixture failure" });
      write(after, "supplementary-review.json", {
        structured: {
          A02: {
            baseline: { label: "missed", candidateCount: 0 },
            current: { label: "partial", candidateCount: 2, reason: "条件の一部を保持 <未確定>" },
          },
          A03: { baseline: { label: "matched", candidateCount: 1 }, current: null },
        },
      });
      const original = readFileSync(join(before, "evaluation.json"));
      expect(() => cli(join(before, "comparison"))).toThrow();
      expect(() => cli(join(before, "..hidden"))).toThrow();
      symlinkSync(before, join(dir, "alias"), "dir");
      expect(() => cli(join(dir, "alias", "comparison"))).toThrow();
      expect(existsSync(join(before, "comparison"))).toBe(false);
      cli(output);
      for (const suffix of ["json", "md", "html", "csv"])
        expect(existsSync(join(output, `comparison.${suffix}`))).toBe(true);
      expect(readFileSync(join(output, "comparison.md"), "utf8")).toContain("共通2件");
      const generated = JSON.parse(readFileSync(join(output, "comparison.json"), "utf8"));
      expect(generated.all.deltaPoints.recall).toBe(-50);
      expect(generated.corrections).toEqual({ baseline: null, current: null });
      const html = readFileSync(join(output, "comparison.html"), "utf8");
      expect(html).toContain("一部保持 / 候補2件");
      expect(html).toContain("条件の一部を保持 &lt;未確定&gt;");
      expect(html).toContain("未評価");
      expect(html).toContain("../cases/A03/failure-0.json");
      expect(html).toContain("未実施・未取得");
      expect(() => cli(output)).toThrow();
      expect(readFileSync(join(before, "evaluation.json"))).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("explicit subset comparison", () => {
  it("renders subset counts and recomputes grades when observed outcomes change", () => {
    const root = mkdtempSync(join(tmpdir(), "live-subset-report-"));
    const selected = {
      personas: [{ id: "A", label: "A", name: "Fixture" }],
      cases: ["A01", "A02"].map((id) => ({
        id,
        personaId: "A",
        input: { characterName: id, workTitle: "Fixture", preference: { likedReasons: "Fixture" } },
        gold: { expected: [{ id: `${id}-E1` }] },
        research: { sourceIds: [] },
      })),
    };
    const write = (name: string, value: unknown) => writeFileSync(join(root, name), JSON.stringify(value));
    const grade = (id: string, matched: boolean) => ({
      expected: [{ id: `${id}-E1`, label: matched ? "matched" : "partial" }],
      claims: [{ id: "Q001", stage: "preference", text: id, label: matched ? "supported" : "unsupported" }],
      issues: [],
    });
    const generate = () =>
      execFileSync(process.execPath, ["scripts/report-live-personas.mjs"], {
        env: { ...process.env, LIVE_RUN_DIR: root, LIVE_FINAL: "0" },
        stdio: "pipe",
      });
    try {
      mkdirSync(join(root, "grading-v2"));
      write("dataset.json", selected);
      write("dataset-manifest.json", { sha256: digest(selected), cases: 2 });
      write("selection.json", { datasetHash: digest(selected), caseIds: ["A01", "A02"] });
      write("progress.json", { cases: { A01: { status: "complete" }, A02: { status: "failed" } } });
      write("grading-v2/A01.json", grade("A01", true));
      generate();
      expect(readFileSync(join(root, "report.html"), "utf8")).toContain("<title>1人・2件 実API評価</title>");
      expect(JSON.parse(readFileSync(join(root, "evaluation.json"), "utf8")).overall).toMatchObject({
        planned: 2,
        complete: 1,
        failed: 1,
        expected: { matched: 1, not_evaluable: 1 },
      });
      write("progress.json", { cases: { A01: { status: "complete" }, A02: { status: "complete" } } });
      write("grading-v2/A02.json", grade("A02", false));
      generate();
      expect(JSON.parse(readFileSync(join(root, "evaluation.json"), "utf8")).overall).toMatchObject({
        planned: 2,
        complete: 2,
        recall: 0.5,
        supportRate: 0.5,
      });
    } finally {
      rmSync(root, { recursive: true });
    }
  });
  it("compares only the selected cases and never borrows full-run usage", () => {
    const subset = selectDataset(dataset, ["A01", "A03"]);
    const current = { ...run(), records: run().records.filter((r) => r.caseId !== "A02"), datasetHash: digest(subset) };
    const result = compareSubsetRuns(run(), current, dataset, subset, { baseline: settings, current: settings }, [
      "A01",
      "A03",
    ]);
    expect(result.rows.map((r: { caseId: string }) => r.caseId)).toEqual(["A01", "A03"]);
    expect(result.all.baseline.cases).toBe(2);
    expect(result.selection.originalCaseCount).toBe(3);
    expect(result.usage.baseline.recordedAppModelCalls).toBeNull();
    expect(() => compareRuns(run(), current, dataset, subset, { baseline: settings, current: settings })).toThrow(
      "DATASET_MISMATCH",
    );
  });
  it("rejects unknown, duplicate, reordered or changed subset inputs", () => {
    for (const ids of [["A99"], ["A01", "A01"], ["A03", "A01"]]) expect(() => selectDataset(dataset, ids)).toThrow();
    const subset = selectDataset(dataset, ["A01"]);
    const changed = { ...subset, sources: { changed: true } };
    expect(() =>
      compareSubsetRuns(run(), run(), dataset, changed, { baseline: settings, current: settings }, ["A01"]),
    ).toThrow("SUBSET_INPUT_MISMATCH");
  });
});
