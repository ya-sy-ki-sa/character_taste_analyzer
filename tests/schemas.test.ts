import { describe, expect, it } from "vitest";
import {
  characterEntryInputSchema,
  correctionInputSchema,
  feedbackInputSchema,
  usernameSchema,
} from "../shared/schemas";

describe("public input contracts", () => {
  it("requires the identifying fields of an existing character", () => {
    expect(
      characterEntryInputSchema.safeParse({
        kind: "existing",
        overview: "十分に長いキャラクター概要です。性格と背景を含みます。",
      }).success,
    ).toBe(false);
  });

  it("allows an original character without a name", () => {
    expect(
      characterEntryInputSchema.safeParse({ kind: "original", overview: "十分に長いオリジナルキャラクター概要です。" })
        .success,
    ).toBe(true);
  });

  it("allows a one-character overview while keeping it required", () => {
    expect(characterEntryInputSchema.safeParse({ kind: "original", overview: "短" }).success).toBe(true);
    expect(characterEntryInputSchema.safeParse({ kind: "original", overview: "" }).success).toBe(false);
    expect(characterEntryInputSchema.safeParse({ kind: "original", overview: "   " }).success).toBe(false);
  });

  it("rejects an empty feedback submission and accepts any single field", () => {
    expect(feedbackInputSchema.safeParse({}).success).toBe(false);
    expect(feedbackInputSchema.safeParse({ overallRating: 4 }).success).toBe(true);
    expect(feedbackInputSchema.safeParse({ comment: "関係性が好き" }).success).toBe(true);
  });

  it("rejects a replacement correction without a valid taxonomy id", () => {
    expect(
      correctionInputSchema.safeParse({ traitId: "values.duty", action: "replace", replacementTraitId: "unknown" })
        .success,
    ).toBe(false);
  });

  it("rejects control characters in public usernames", () => {
    expect(usernameSchema.safeParse("公開\u0000名").success).toBe(false);
  });
});
