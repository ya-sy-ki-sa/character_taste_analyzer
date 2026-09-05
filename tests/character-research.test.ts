import { afterEach, describe, expect, it, vi } from "vitest";
import { type EntryDraft, entryDraftSchema } from "../shared/contracts/entries";
import { collectCharacterResearch } from "../worker/features/analysis/research";
import type { Env } from "../worker/types";

const existing: EntryDraft = entryDraftSchema.parse({
  registrationType: "existing",
  workTitle: "架空作品",
  characterName: "登場人物A",
  identityResolution: { mode: "new" },
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
    expect(result.sources[0]?.provider).toBe("wikipedia_ja");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("adds only target-matched Wikidata items to the trusted source set", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://ja.wikipedia.org/")) return Response.json({ query: { pages: [] } });
      return Response.json({
        search: [
          {
            id: "Q123",
            label: "登場人物A",
            description: "架空作品に登場する人物",
            aliases: ["人物A"],
          },
          {
            id: "Q999",
            label: "登場人物A",
            description: "別作品に登場する同名人物",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(env("workers_ai"), existing);
    expect(result.status).toBe("collected");
    expect(result.sources).toEqual([
      expect.objectContaining({
        provider: "wikidata",
        url: "https://www.wikidata.org/wiki/Q123",
        trustReason: expect.stringContaining("作品名とキャラクター名の両方"),
      }),
    ]);
    expect(result.sources.some((source) => source.url.endsWith("Q999"))).toBe(false);
  });

  it("accepts the Wikidata item linked by a target-matched Wikipedia page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://ja.wikipedia.org/")) {
        return Response.json({
          query: {
            pages: [
              {
                title: "うずまきナルト",
                fullurl: "https://ja.wikipedia.org/wiki/example-naruto",
                extract: "NARUTOに登場するうずまきナルトは、物語の主人公である。",
                pageprops: { wikibase_item: "Q931" },
              },
            ],
          },
        });
      }
      return Response.json({
        search: [
          {
            id: "Q931",
            label: "うずまきナルト",
            description: "岸本斉史の漫画及びそれを原作としたアニメに登場する架空の人物",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
        registrationType: "existing",
        workTitle: "NARUTO",
        characterName: "うずまきナルト",
        identityResolution: { mode: "new" },
        preference: { responseChannels: [] },
      }),
    );
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "wikipedia_ja" }),
        expect.objectContaining({
          provider: "wikidata",
          url: "https://www.wikidata.org/wiki/Q931",
          trustReason: expect.stringContaining("日本語Wikipediaページに紐づく"),
        }),
      ]),
    );
  });

  it("does not access the network in deterministic test profiles", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(env("replay"), existing);
    expect(result.status).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the base character name when researching a customized character", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        query: {
          pages: [
            {
              title: "うずまきナルト",
              fullurl: "https://ja.wikipedia.org/wiki/example-naruto",
              extract: "NARUTOに登場するうずまきナルトは、物語の主人公である。",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
        registrationType: "customized_existing",
        workTitle: "NARUTO",
        baseCharacterName: "うずまきナルト",
        characterName: "暁ナルト",
        representationType: "transformative",
        customizationDescription: "犯罪組織「暁」に所属しているナルト",
        identityResolution: { mode: "new" },
        preference: { responseChannels: [] },
      }),
    );
    expect(result.status).toBe("collected");
    expect(result.query).toContain("NARUTO うずまきナルト");
    expect(result.query).not.toContain("暁ナルト");
  });

  it("does not search for an original character", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
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
