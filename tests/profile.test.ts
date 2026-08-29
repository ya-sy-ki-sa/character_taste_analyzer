import { describe, expect, it } from "vitest";
import {
  buildClusters,
  buildTasteProfile,
  type EntryVector,
  type ProfileEvidence,
  type ProfileSignal,
} from "../worker/domain/profile";

const evidence = (
  overrides: Partial<ProfileEvidence> & Pick<ProfileEvidence, "id" | "entryId" | "traitId">,
): ProfileEvidence => ({
  workKey: null,
  confidence: 1,
  observation: "stated",
  source: "llm",
  ...overrides,
});

const signal = (
  overrides: Partial<ProfileSignal> & Pick<ProfileSignal, "id" | "traitId" | "polarity">,
): ProfileSignal => ({
  strength: 1,
  ...overrides,
});

function profile(overrides: Partial<Parameters<typeof buildTasteProfile>[0]> = {}) {
  return buildTasteProfile({
    profileVersion: 1,
    entryCount: 0,
    evidence: [],
    signals: [],
    entries: [],
    generatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  });
}

describe("deterministic taste aggregation", () => {
  it("is byte-for-byte reproducible for the same normalized inputs", () => {
    const input = {
      entryCount: 2,
      evidence: [
        evidence({ id: "a", entryId: "entry-1", traitId: "temperament.warm" }),
        evidence({ id: "b", entryId: "entry-2", traitId: "temperament.warm", confidence: 0.8 }),
      ],
      signals: [signal({ id: "s", traitId: "temperament.warm", polarity: "positive" as const })],
      entries: [] as EntryVector[],
    };
    expect(profile(input)).toEqual(profile(input));
  });

  it("keeps occurrence separate from explicit preference", () => {
    const result = profile({
      entryCount: 1,
      evidence: [evidence({ id: "a", entryId: "entry-1", traitId: "temperament.stoic" })],
    });
    expect(result.frequentTraits[0]?.traitId).toBe("temperament.stoic");
    expect(result.explicitLikes).toEqual([]);
    expect(result.explicitDislikes).toEqual([]);
  });

  it("deduplicates the same character and trait while preferring a manual correction", () => {
    const result = profile({
      entryCount: 1,
      evidence: [
        evidence({ id: "llm", entryId: "entry-1", traitId: "values.duty", confidence: 0.95 }),
        evidence({ id: "manual", entryId: "entry-1", traitId: "values.duty", confidence: 1, source: "manual" }),
      ],
    });
    expect(result.frequentTraits[0]).toMatchObject({ evidenceCount: 1, evidenceIds: ["manual"] });
  });

  it("downweights repeated evidence from one work", () => {
    const sameWork = profile({
      entryCount: 3,
      evidence: [1, 2, 3].map((index) =>
        evidence({ id: `e${index}`, entryId: `entry-${index}`, traitId: "values.freedom", workKey: "one-work" }),
      ),
    });
    const differentWorks = profile({
      entryCount: 3,
      evidence: [1, 2, 3].map((index) =>
        evidence({ id: `e${index}`, entryId: `entry-${index}`, traitId: "values.freedom", workKey: `work-${index}` }),
      ),
    });
    expect(sameWork.frequentTraits[0].occurrenceWeight).toBeLessThan(differentWorks.frequentTraits[0].occurrenceWeight);
  });

  it("marks opposed explicit evidence as contextual contradiction", () => {
    const result = profile({
      signals: [
        signal({ id: "like", traitId: "relationship.rivalry", polarity: "positive", strength: 0.8 }),
        signal({ id: "avoid", traitId: "relationship.rivalry", polarity: "negative", strength: 0.7 }),
      ],
    });
    expect(result.contradictions.map((item) => item.traitId)).toContain("relationship.rivalry");
    expect(result.explicitLikes.map((item) => item.traitId)).toContain("relationship.rivalry");
  });

  it("treats fewer than three entries as provisional", () => {
    expect(profile({ entryCount: 2 }).provisional).toBe(true);
    expect(profile({ entryCount: 3 }).provisional).toBe(false);
  });
});

describe("deterministic clustering", () => {
  it("does not cluster fewer than eight entries", () => {
    expect(buildClusters(Array.from({ length: 7 }, (_, index) => ({ entryId: String(index), traitIds: [] })))).toEqual(
      [],
    );
  });

  it("finds two well-separated preference groups from eight entries", () => {
    const entries: EntryVector[] = [
      ...Array.from({ length: 4 }, (_, index) => ({
        entryId: `a-${index}`,
        traitIds: ["temperament.warm", "relationship.devoted"],
        embedding: [1, 0.01 * index],
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        entryId: `b-${index}`,
        traitIds: ["temperament.cunning", "narrative.strategist"],
        embedding: [0.01 * index, 1],
      })),
    ];
    const clusters = buildClusters(entries);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((item) => item.entryIds.length)).toEqual([4, 4]);
    expect(clusters.flatMap((item) => item.entryIds).sort()).toEqual(entries.map((item) => item.entryId).sort());
  });
});
