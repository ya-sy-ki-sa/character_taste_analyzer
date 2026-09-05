import { describe, expect, it } from "vitest";
import {
  type AssertionRow,
  aggregateContributions,
  buildDimensions,
  buildValueStances,
  type ValueStanceRow,
  weightAssertions,
} from "../worker/features/profile/aggregation";

const contributions = [
  { entry_id: "a", character_identity_id: "hero", work_id: "book", score: 0.8 },
  { entry_id: "a", character_identity_id: "hero", work_id: "book", score: 0.4 },
  { entry_id: "b", character_identity_id: "hero", work_id: "book", score: 0.6 },
  { entry_id: "c", character_identity_id: "rival", work_id: "book", score: 0.6 },
  { entry_id: "d", character_identity_id: "stranger", work_id: "another", score: 0.3 },
];

describe("profile contribution aggregation", () => {
  it("deduplicates entries and discounts repeated identities and works before combining independent works", () => {
    const result = aggregateContributions(contributions, (row) => row.score);
    expect(result.score).toBeCloseTo(0.9167, 12);
    expect(result).toMatchObject({ identityCount: 3, workCount: 2 });
  });

  it("keeps original characters independent and handles an empty profile", () => {
    const rows = [contributions[0], contributions[3]].map((row) => ({ ...row, work_id: null }));
    expect(aggregateContributions(rows, (row) => row.score)).toEqual({
      score: 0.92,
      identityCount: 2,
      workCount: 2,
    });
    expect(aggregateContributions([], () => 0)).toEqual({ score: 0, identityCount: 0, workCount: 0 });
  });

  it("preserves value stance evidence counts while discounting duplicate contributions", () => {
    const rows: ValueStanceRow[] = contributions.map((row, index) => ({
      ...row,
      id: String(index),
      target_type: "character",
      target_ref: "架空の人物",
      stance: "approve",
      orientation: "toward_character",
      scope_json: "{}",
      explicitness: "user_explicit",
      confidence: row.score,
      evidence_quality: 1,
      evidence_count: 1,
      evidence_fingerprint: String(index),
      status: "confirmed",
      analysis_domain: "standard",
    }));
    expect(buildValueStances(rows)).toMatchObject([
      { aggregatedConfidence: 0.9167, assertionCount: 5, evidenceCount: 5, identityCount: 3, workCount: 2 },
    ]);
  });

  it.each(["standard", "dark"] as const)("preserves mixed polarity and unresolved channels in %s", async (domain) => {
    const row: AssertionRow = {
      id: "assertion",
      entry_id: "entry",
      entry_revision_id: "revision",
      character_identity_id: "character",
      work_id: "work",
      attribute_definition_id: "attribute",
      stable_key: "change.corruption",
      label: "変化",
      category: "change",
      raw_label: "変化",
      normalized_label: "変化",
      polarity: "mixed",
      response_channel: null,
      strength: 0.8,
      explicitness: "user_explicit",
      confidence: 0.5,
      context_json: "{}",
      status: "confirmed",
      evidence_count: 3,
      evidence_quality: 1,
      evidence_fingerprint: "evidence",
      analysis_domain: domain,
    };
    expect(buildDimensions(await weightAssertions([row]))).toMatchObject([
      {
        positiveScore: 0.2,
        negativeScore: 0.2,
        confidence: 0.15125,
        responseChannel: null,
        flags: ["response_channel_unresolved"],
        classification: "insufficient",
        analysisDomain: domain,
      },
    ]);
  });
});
