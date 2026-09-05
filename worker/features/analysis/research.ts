import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import { entryBaseCharacterName } from "../../../shared/entry-input";
import { normalizeIdentityPart } from "../../lib/crypto";
import type { Env } from "../../types";

export type CharacterResearchSource = {
  title: string;
  url: string;
  excerpt: string;
  provider: "wikipedia_ja" | "wikidata";
  trustReason: string;
};

export type CharacterResearch = {
  status: "collected" | "not_found" | "unavailable" | "not_applicable" | "disabled";
  query?: string;
  sources: CharacterResearchSource[];
  limitation?: string;
};

type WikipediaPage = {
  title?: unknown;
  fullurl?: unknown;
  extract?: unknown;
  pageprops?: { wikibase_item?: unknown };
};

type WikidataSearchResult = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  aliases?: unknown;
};

type ResearchAdapterResult = {
  available: boolean;
  sources: CharacterResearchSource[];
  limitation?: string;
  linkedWikidataIds?: string[];
};

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

function matchesTarget(text: string, expectedCharacter: string, expectedWork: string): boolean {
  const searchable = normalizeIdentityPart(text);
  return searchable.includes(expectedCharacter) && searchable.includes(expectedWork);
}

async function collectWikipedia(
  query: string,
  expectedCharacter: string,
  expectedWork: string,
): Promise<ResearchAdapterResult> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "6",
    prop: "extracts|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exsentences: "6",
    inprop: "url",
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  try {
    const response = await fetch(`https://ja.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": "CharacterTasteLab/0.1 character-research" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return {
        available: false,
        sources: [],
        limitation: `Wikipedia検索がHTTP ${response.status}を返した`,
      };
    }
    const payload = (await response.json()) as {
      query?: { pages?: WikipediaPage[] };
    };
    const matchedPages = (payload.query?.pages ?? [])
      .map((page) => ({
        title: boundedText(page.title, 200),
        url: boundedText(page.fullurl, 1_000),
        excerpt: boundedText(page.extract, 2_500),
        wikidataId: boundedText(page.pageprops?.wikibase_item, 32),
        provider: "wikipedia_ja" as const,
        trustReason: "日本語Wikipedia APIから取得し、作品名とキャラクター名の一致を確認",
      }))
      .filter((page) => page.title && page.url && page.excerpt)
      .filter((page) => matchesTarget(`${page.title} ${page.excerpt}`, expectedCharacter, expectedWork))
      .slice(0, 4);
    return {
      available: true,
      sources: matchedPages.map(({ wikidataId: _wikidataId, ...source }) => source),
      linkedWikidataIds: matchedPages.map((page) => page.wikidataId).filter((id) => /^Q\d+$/u.test(id)),
    };
  } catch (error) {
    return {
      available: false,
      sources: [],
      limitation:
        error instanceof Error ? `Wikipedia検索: ${error.message.slice(0, 250)}` : "Wikipedia検索に接続できなかった",
    };
  }
}

async function collectWikidata(
  query: string,
  expectedCharacter: string,
  expectedWork: string,
  linkedWikidataIds: Promise<ReadonlySet<string>>,
): Promise<ResearchAdapterResult> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "ja",
    uselang: "ja",
    type: "item",
    limit: "6",
    format: "json",
    origin: "*",
  });
  try {
    const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { "User-Agent": "CharacterTasteLab/0.1 character-research" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return {
        available: false,
        sources: [],
        limitation: `Wikidata検索がHTTP ${response.status}を返した`,
      };
    }
    const payload = (await response.json()) as {
      search?: WikidataSearchResult[];
    };
    const trustedLinkedIds = await linkedWikidataIds;
    const sources = (payload.search ?? [])
      .map((item) => {
        const id = boundedText(item.id, 32);
        const label = boundedText(item.label, 200);
        const description = boundedText(item.description, 1_500);
        const aliases = Array.isArray(item.aliases)
          ? item.aliases
              .map((alias) => boundedText(alias, 200))
              .filter(Boolean)
              .slice(0, 20)
          : [];
        return {
          id,
          title: label,
          url: /^Q\d+$/u.test(id) ? `https://www.wikidata.org/wiki/${id}` : "",
          excerpt: [label, description].filter(Boolean).join("。"),
          searchable: [label, description, ...aliases].join(" "),
        };
      })
      .filter((item) => item.title && item.url && item.excerpt)
      .filter(
        (item) => matchesTarget(item.searchable, expectedCharacter, expectedWork) || trustedLinkedIds.has(item.id),
      )
      .slice(0, 4)
      .map(({ searchable: _searchable, id, ...source }) => ({
        ...source,
        provider: "wikidata" as const,
        trustReason: trustedLinkedIds.has(id)
          ? "作品名とキャラクター名が一致した日本語Wikipediaページに紐づくWikidata項目"
          : "Wikidata APIから取得し、作品名とキャラクター名の両方が項目説明に一致",
      }));
    return { available: true, sources };
  } catch (error) {
    return {
      available: false,
      sources: [],
      limitation:
        error instanceof Error ? `Wikidata検索: ${error.message.slice(0, 250)}` : "Wikidata検索に接続できなかった",
    };
  }
}

export async function collectCharacterResearch(env: Env, draft: AnyEntryDraft): Promise<CharacterResearch> {
  if (draft.registrationType === "original") return { status: "not_applicable", sources: [] };
  if (env.LLM_PROVIDER === "replay" || env.LLM_PROVIDER === "fake") {
    return {
      status: "disabled",
      sources: [],
      limitation: "決定論的テストでは外部検索を行わない",
    };
  }

  const baseCharacterName = entryBaseCharacterName(draft);
  const query = [draft.workTitle, baseCharacterName, draft.mediaType].filter(Boolean).join(" ");
  const wikipediaQuery = [`"${baseCharacterName}"`, draft.workTitle, draft.mediaType].filter(Boolean).join(" ");
  const expectedCharacter = normalizeIdentityPart(baseCharacterName);
  const expectedWork = normalizeIdentityPart(draft.workTitle);
  const wikipediaPromise = collectWikipedia(wikipediaQuery, expectedCharacter, expectedWork);
  const wikidataPromise = collectWikidata(
    baseCharacterName,
    expectedCharacter,
    expectedWork,
    wikipediaPromise.then((wikipedia) => new Set(wikipedia.linkedWikidataIds ?? [])),
  );
  const [wikipedia, wikidata] = await Promise.all([wikipediaPromise, wikidataPromise]);
  const adapters = [wikipedia, wikidata];
  const sources = [
    ...new Map(adapters.flatMap((adapter) => adapter.sources).map((source) => [source.url, source])).values(),
  ];
  const limitations = adapters.map((adapter) => adapter.limitation).filter((item): item is string => Boolean(item));
  if (sources.length) {
    return {
      status: "collected",
      query,
      sources,
      ...(limitations.length ? { limitation: limitations.join("／").slice(0, 500) } : {}),
    };
  }
  return {
    status: adapters.every((adapter) => !adapter.available) ? "unavailable" : "not_found",
    query,
    sources: [],
    limitation: limitations.length
      ? limitations.join("／").slice(0, 500)
      : "Wikipedia・Wikidataで作品名とキャラクター名が一致する説明を取得できなかった",
  };
}
