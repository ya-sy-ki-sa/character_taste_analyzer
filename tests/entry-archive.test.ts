import { afterEach, describe, expect, it } from "vitest";
import { archiveEntry } from "../worker/features/entries/archive";
import { listEntries } from "../worker/features/entries/list";
import { testDatabase } from "./support/database";
import { seedEntry, seedUser } from "./support/fixtures";

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("character entry archive", () => {
  it("archives an entry whose analysis failed", async () => {
    current = testDatabase();
    seedUser(current.database);
    seedEntry(current.database, {
      id: "failed-entry",
      status: "failed",
      payload: { registrationType: "existing", workTitle: "失敗作品", characterName: "解析失敗キャラ" },
    });

    await expect(archiveEntry(current.env, "owner", "standard", "failed-entry")).resolves.toMatchObject({
      outboxEventId: expect.any(String),
    });

    expect(current.database.prepare("SELECT status,archived_at FROM user_character_entries").get()).toMatchObject({
      status: "archived",
      archived_at: expect.any(String),
    });
  });

  it("does not return archived entries in the registration list", async () => {
    current = testDatabase();
    seedUser(current.database);
    seedEntry(current.database, {
      id: "failed-entry",
      status: "failed",
      payload: { registrationType: "existing", workTitle: "失敗作品", characterName: "解析失敗キャラ" },
    });
    seedEntry(current.database, {
      id: "archived-entry",
      status: "archived",
      payload: { registrationType: "existing", workTitle: "除外作品", characterName: "除外済みキャラ" },
    });

    const entries = await listEntries(current.env, "owner", "standard");

    expect(entries.map((entry) => entry.id)).toEqual(["failed-entry"]);
  });
});
