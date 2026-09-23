import { describe, expect, it } from "vitest";
import { selectValueStanceAssertions } from "../worker/features/profile/repositories/projection";
import { testDatabase } from "./support/database";
import { seedReview } from "./support/fixtures";

describe("profile value stance query", () => {
  it("limits display reads to the requested domain while keeping rebuild reads across domains", async () => {
    const test = testDatabase();
    try {
      seedReview(test.database);
      test.database.exec("UPDATE user_character_entries SET status='active', analysis_domain='dark'");
      test.database.exec("UPDATE value_stance_assertions SET status='confirmed'");

      const all = await selectValueStanceAssertions(test.DB, ["owner", "owner"]).all<{ id: string }>();
      const standard = await selectValueStanceAssertions(test.DB, ["owner", "owner", "standard"]).all<{ id: string }>();
      const dark = await selectValueStanceAssertions(test.DB, ["owner", "owner", "dark"]).all<{ id: string }>();

      expect(all.results.map((row) => row.id)).toEqual(["stance"]);
      expect(standard.results).toEqual([]);
      expect(dark.results.map((row) => row.id)).toEqual(["stance"]);
    } finally {
      test.close();
    }
  });
});
