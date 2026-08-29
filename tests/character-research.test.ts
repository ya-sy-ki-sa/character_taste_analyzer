import { afterEach, describe, expect, it, vi } from "vitest";
import { type EntryDraft, entryDraftSchema } from "../shared/schemas";
import { collectCharacterResearch } from "../worker/services/character-research";
import type { Env } from "../worker/types";

const existing: EntryDraft = entryDraftSchema.parse({
  schemaVersion: "1",
  registrationType: "existing",
  workTitle: "架空作品",
  characterName: "登場人物A",
  preference: { responseChannels: [] },
});

function env(provider: Env["LLM_PROVIDER"]): Env {
  return { LLM_PROVIDER: provider } as Env;
}

describe("system-side character research", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collects bounded public information for an existing character", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        query: {
          pages: [
            {
              title: "登場人物A",
              fullurl: "https://ja.wikipedia.org/wiki/example",
              extract: "架空作品に登場する人物。物語上の役割と行動が説明されている。",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(env("workers_ai"), existing);
    expect(result.status).toBe("collected");
    expect(result.query).toContain("架空作品 登場人物A");
    expect(result.sources[0]?.url).toBe("https://ja.wikipedia.org/wiki/example");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not access the network in deterministic test profiles", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(env("replay"), existing);
    expect(result.status).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not search for an original character", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
        schemaVersion: "1",
        registrationType: "original",
        characterName: "オリジナルA",
        characterBasicInfo: "自分で作ったオリジナルキャラクターの基本的な設定。",
        preference: { responseChannels: [] },
      }),
    );
    expect(result.status).toBe("not_applicable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
