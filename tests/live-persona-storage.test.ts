import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error JS evaluation module
import { validateGrade } from "../evaluation/live-personas/grading.mjs";
// @ts-expect-error JS tool module
import * as liveStorage from "../evaluation/live-personas/storage.mjs";

const {
  buildCaseJudgmentAudits,
  preserveJson,
  readJson,
  sameInput,
  sanitizeJudgmentLog,
  selectResumeEntry,
  selectSafeRuntimeSettings,
} = liveStorage;

describe("persistent live evaluation evidence", () => {
  it("preserves the first observation when a resumed run sees another result", () => {
    const dir = mkdtempSync(join(tmpdir(), "persona-evidence-"));
    try {
      const path = join(dir, "first.json");
      expect(preserveJson(path, { value: "original" })).toBe(true);
      expect(preserveJson(path, { value: "later" })).toBe(false);
      expect(readJson(path)).toEqual({ value: "original" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("refuses ambiguous reconciliation rather than creating a third entry", () => {
    expect(() => selectResumeEntry([{ entryId: "a" }, { entryId: "b" }])).toThrow("AMBIGUOUS");
    expect(selectResumeEntry([{ entryId: "a" }])).toEqual({ entryId: "a" });
  });
  it("does not equate the same character with a different reason or adaptation", () => {
    const a = { characterName: "same", mediaType: "1999", preference: { likedReasons: "memory" } };
    expect(sameInput(a, { ...a, mediaType: "2011" })).toBe(false);
    expect(sameInput(a, { ...a, preference: { likedReasons: "hero" } })).toBe(false);
    expect(sameInput(a, { ...a, preference: { ...a.preference, responseChannels: ["person_liking"] } })).toBe(false);
    expect(sameInput(a, { ...a, referenceMaterial: "", preference: { ...a.preference, responseChannels: [] } })).toBe(
      true,
    );
  });
  it("rejects incomplete, duplicated or untraceable grading evidence", () => {
    const c = { id: "A01", gold: { expected: [{ id: "E1" }] } };
    const claims = [{ id: "Q1" }, { id: "Q2" }];
    const grade = { caseId: "A01", claims, expected: [{ id: "E1", claimIds: ["Q1"] }], issues: [] };
    expect(validateGrade(grade, c, claims)).toBe(grade);
    expect(() => validateGrade({ ...grade, claims: [{ id: "Q1" }] }, c, claims)).toThrow("COVERAGE");
    expect(() => validateGrade({ ...grade, claims: [{ id: "Q1" }, { id: "Q1" }] }, c, claims)).toThrow("COVERAGE");
    expect(() => validateGrade({ ...grade, expected: [{ id: "E1", claimIds: ["Q9"] }] }, c, claims)).toThrow(
      "UNKNOWN_CLAIM",
    );
  });
  it("records Jev settings without copying credentials", () => {
    expect(
      selectSafeRuntimeSettings({
        JEV_PROVIDER: "typesafe",
        JEV_MODEL: "typesafe/jev",
        AI_GATEWAY_TOKEN: "secret",
      }),
    ).toMatchObject({ JEV_PROVIDER: "typesafe", JEV_MODEL: "typesafe/jev" });
    expect(selectSafeRuntimeSettings({ JEV_PROVIDER: "typesafe", AI_GATEWAY_TOKEN: "secret" })).not.toHaveProperty(
      "AI_GATEWAY_TOKEN",
    );
  });
  it("sanitizes live Jev decisions and excludes request state", () => {
    const events = sanitizeJudgmentLog(
      `${JSON.stringify({
        event: "judgment_completed",
        correlationId: "revision-1",
        stage: "preference:assertion",
        provider: "typesafe",
        model: "jev-1.12",
        questionHash: "hash",
        questionCount: 1,
        state: { secret: "must-not-survive" },
        decisions: [
          {
            id: "preference_0_classification",
            type: "choice",
            selected: "preference",
            confidence: 0.91,
            probabilities: { preference: 0.94, no_match: 0.06 },
          },
        ],
      })}\n`,
    );
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: "revision-1",
        provider: "typesafe",
        answers: [expect.objectContaining({ selected: "preference", confidence: 0.91 })],
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("must-not-survive");
  });
  it("aggregates final accepted, degraded and rejected semantic outcomes per case", () => {
    const audit = (targetId: string, keep: boolean, reasonCode: string, diagnosticCodes: string[] = []) => ({
      policyVersion: "analysis-judgment/2.1",
      targetId,
      keep,
      reasonCode,
      diagnosticCodes,
      after: { confidence: keep ? 0.6 : 0 },
    });
    const exported = {
      entries: { revisions: [{ id: "revision-1", entry_id: "entry-1", revision_number: 1 }] },
      preferenceAnalysis: {
        runs: [
          {
            id: "preference-run",
            entry_revision_id: "revision-1",
            quality_context_json: JSON.stringify({
              semanticAudit: {
                policyVersion: "analysis-judgment/2.1",
                assertions: [
                  audit("accepted", true, "accepted"),
                  audit("degraded", true, "accepted_verified_subset", ["invalid_set_index"]),
                  audit("rejected", false, "judgment_rejected", ["high_conflict"]),
                ],
              },
            }),
          },
        ],
      },
    };
    const result = buildCaseJudgmentAudits(exported, { A01: { entryId: "entry-1" } }, [
      { correlationId: "revision-1", answers: [] },
    ]);
    expect(result.A01.outcomes.map((item: { disposition: string }) => item.disposition)).toEqual([
      "accepted",
      "degraded",
      "rejected",
    ]);
    expect(result.A01.outcomes[1].diagnosticCodes).toContain("invalid_set_index");
    expect(result.A01.outcomes[2].diagnosticCodes).toContain("high_conflict");
  });
});
