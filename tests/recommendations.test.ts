import { describe, expect, it } from "vitest";
import type { CharacterRecommendationResult } from "../shared/schemas";
import { buildTasteProfile, type ProfileEvidence, type ProfileSignal } from "../worker/domain/profile";
import {
  buildRecommendationInput,
  hasRecommendationEvidence,
  normalizeRecommendationResult,
  recommendationMessages,
} from "../worker/services/recommendations";

const traitId = "temperament.stoic";

function profile() {
  const evidence: ProfileEvidence[] = [
    {
      id: "evidence-private-id",
      entryId: "entry-private-id",
      workKey: "work-private-id",
      traitId,
      confidence: 0.9,
      observation: "inferred",
      source: "llm",
    },
  ];
  const signals: ProfileSignal[] = [{ id: "signal-private-id", traitId, polarity: "positive", strength: 0.8 }];
  return buildTasteProfile({
    profileVersion: 1,
    entryCount: 1,
    evidence,
    signals,
    entries: [],
    generatedAt: "2026-08-29T00:00:00.000Z",
  });
}

function candidate(
  characterName: string,
  workTitle: string,
  matchedTraitIds = [traitId],
): CharacterRecommendationResult["candidates"][number] {
  return {
    characterName,
    workTitle,
    mediaType: "小説",
    matchedTraitIds,
    reason: "冷静さと責任感が、分析された傾向と一致します。",
    possibleMismatch: null,
    likelihood: "medium",
  };
}

describe("existing-character recommendations", () => {
  it("sends only abstract profile evidence and recent candidate names to the LLM", () => {
    const input = buildRecommendationInput(profile(), [{ characterName: "既出人物", workTitle: "既出作品" }]);
    const serialized = JSON.stringify(input);

    expect(input.frequentTraits[0]).toMatchObject({ id: traitId, label: "冷静・ストイック" });
    expect(serialized).not.toContain("entry-private-id");
    expect(serialized).not.toContain("evidence-private-id");
    expect(serialized).not.toContain("signal-private-id");
    expect(serialized).toContain("既出人物");
    expect(recommendationMessages(input)[0].content).toContain("同じ作品からは最大1人");
  });

  it("requires at least one frequent or explicitly liked trait", () => {
    const empty = buildTasteProfile({
      profileVersion: 1,
      entryCount: 1,
      evidence: [],
      signals: [],
      entries: [],
      generatedAt: "2026-08-29T00:00:00.000Z",
    });
    expect(hasRecommendationEvidence(empty)).toBe(false);
    expect(hasRecommendationEvidence(profile())).toBe(true);
  });

  it("deduplicates works and removes trait ids that are not supported by the profile", () => {
    const result: CharacterRecommendationResult = {
      selectionNote: "傾向を横断して選びました。",
      candidates: [
        candidate("人物A", "作品A", [traitId, "values.duty"]),
        candidate("人物A-別候補", "作品A"),
        candidate("根拠なし", "作品B", ["values.duty"]),
        candidate("人物C", "作品C"),
        candidate("人物D", "作品D"),
        candidate("人物E", "作品E"),
      ],
    };

    const normalized = normalizeRecommendationResult(result, profile());
    expect(normalized.candidates.map((item) => item.workTitle)).toEqual(["作品A", "作品C", "作品D", "作品E"]);
    expect(normalized.candidates[0]?.matchedTraitIds).toEqual([traitId]);
  });

  it("rejects an output when filtering leaves fewer than four reliable candidates", () => {
    const result: CharacterRecommendationResult = {
      selectionNote: "候補です。",
      candidates: [
        candidate("人物A", "作品A"),
        candidate("人物B", "作品A"),
        candidate("人物C", "作品C", ["values.duty"]),
        candidate("人物D", "作品D"),
      ],
    };
    expect(() => normalizeRecommendationResult(result, profile())).toThrow("recommendation_quality_failed");
  });
});
