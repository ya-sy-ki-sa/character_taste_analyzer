import { describe, expect, it } from "vitest";
import { boundedInteger } from "../worker/lib/numbers";

describe("bounded integer configuration", () => {
  it.each([undefined, "", "not-a-number", "1.5", Number.POSITIVE_INFINITY])(
    "uses the fallback for invalid input: %s",
    (value) => {
      expect(boundedInteger(value, 30)).toBe(30);
    },
  );

  it("clamps valid integers to the configured range", () => {
    expect(boundedInteger("0", 30, { min: 1, max: 50 })).toBe(1);
    expect(boundedInteger("100", 30, { min: 1, max: 50 })).toBe(50);
    expect(boundedInteger("20", 30, { min: 1, max: 50 })).toBe(20);
  });
});
