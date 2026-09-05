import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error JS evaluation module
import { validateGrade } from "../evaluation/live-personas/grading.mjs";
// @ts-expect-error JS tool module
import { preserveJson, readJson, sameInput, selectResumeEntry } from "../evaluation/live-personas/storage.mjs";

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
});
