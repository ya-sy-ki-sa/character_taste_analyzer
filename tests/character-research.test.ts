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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("resolves Japanese input through trusted Wikidata sitelinks and rejects a mismatched page ID", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("User-Agent")).toContain(
        "https://github.com/ya-sy-ki-sa/character_taste_analyzer/issues",
      );
      const url = new URL(String(input));
      if (url.hostname === "ja.wikipedia.org") return Response.json({ query: { pages: [] } });
      if (url.searchParams.get("action") === "wbsearchentities") {
        return Response.json({
          search: [
            { id: "Q123", label: "登場人物A", description: "架空作品に登場する人物" },
            { id: "Q999", label: "登場人物A", description: "別作品の同名人物" },
          ],
        });
      }
      if (url.searchParams.get("action") === "wbgetentities") {
        expect(url.searchParams.get("ids")).toBe("Q123");
        return Response.json({ entities: { Q123: { sitelinks: { enwiki: { title: "Character A" } } } } });
      }
      expect(url.hostname).toBe("en.wikipedia.org");
      expect(url.searchParams.get("titles")).toBe("Character A");
      expect(url.searchParams.has("generator")).toBe(false);
      return Response.json({
        query: {
          pages: [
            {
              title: "Character A",
              fullurl: "https://en.wikipedia.org/wiki/Character_A",
              extract: "A hero in Fictional Work.",
              pageprops: { wikibase_item: "Q123" },
            },
            {
              title: "登場人物A",
              fullurl: "https://en.wikipedia.org/wiki/Wrong",
              extract: "架空作品",
              pageprops: { wikibase_item: "Q999" },
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectCharacterResearch(env("workers_ai"), existing);
    expect(result.sources.filter((source) => source.provider === "wikipedia_en")).toEqual([
      expect.objectContaining({
        title: "Character A",
        excerpt: "A hero in Fictional Work.",
        trustReason: expect.stringContaining("項目IDの一致"),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("searches English input directly and keeps only matching character and work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).startsWith("https://en.wikipedia.org")) return Response.json({});
        return Response.json({
          query: {
            pages: [
              { title: "Hero", fullurl: "https://en.wikipedia.org/wiki/Hero", extract: "Hero from Example Work." },
              { title: "Hero", fullurl: "https://en.wikipedia.org/wiki/Other", extract: "Hero from another work." },
            ],
          },
        });
      }),
    );
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
        ...existing,
        characterName: "Hero",
        workTitle: "Example Work",
      }),
    );
    expect(result.sources).toEqual([expect.objectContaining({ provider: "wikipedia_en", title: "Hero" })]);
  });

  it("retains Japanese sources when English Wikipedia fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("https://en.wikipedia.org")) return new Response("", { status: 429 });
        if (String(input).startsWith("https://www.wikidata.org")) return Response.json({});
        return Response.json({
          query: {
            pages: [{ title: "登場人物A", fullurl: "https://ja.wikipedia.org/wiki/A", extract: "架空作品の登場人物" }],
          },
        });
      }),
    );
    const result = await collectCharacterResearch(env("workers_ai"), existing);
    expect(result.status).toBe("collected");
    expect(result.sources[0]?.provider).toBe("wikipedia_ja");
    expect(result.limitation).toContain("英語Wikipedia検索がHTTP 429");
  });

  it("falls back to English search when sitelink lookup fails and reports the limitation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.searchParams.get("action") === "wbgetentities") return Response.json({ error: { code: "maxlag" } });
        if (url.searchParams.get("action") === "wbsearchentities")
          return Response.json({ search: [{ id: "Q123", label: "Hero", description: "Example Work character" }] });
        if (url.hostname === "en.wikipedia.org")
          return Response.json({
            query: {
              pages: [
                { title: "Hero", fullurl: "https://en.wikipedia.org/wiki/Hero", extract: "Example Work character" },
              ],
            },
          });
        return Response.json({});
      }),
    );
    const result = await collectCharacterResearch(
      env("workers_ai"),
      entryDraftSchema.parse({
        ...existing,
        characterName: "Hero",
        workTitle: "Example Work",
      }),
    );
    expect(result.sources.some((source) => source.provider === "wikipedia_en")).toBe(true);
    expect(result.limitation).toContain("言語間リンク取得失敗");
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
