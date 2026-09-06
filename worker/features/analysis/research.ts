import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import { entryBaseCharacterName } from "../../../shared/entry-input";
import { normalizeIdentityPart } from "../../lib/crypto";
import type { Env } from "../../types";

const RESEARCH_USER_AGENT =
  "CharacterTasteLab/0.1 (https://github.com/ya-sy-ki-sa/character_taste_analyzer/issues) character-research";

export type CharacterResearchSource = {
  title: string;
  url: string;
  excerpt: string;
  provider: "wikipedia_ja" | "wikipedia_en" | "wikidata";
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
  language: "ja" | "en" = "ja",
  linkedTitles: string[] = [],
  trustedIds: ReadonlySet<string> = new Set(),
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
  if (linkedTitles.length) {
    for (const key of ["generator", "gsrsearch", "gsrnamespace", "gsrlimit"]) params.delete(key);
    params.set("titles", linkedTitles.join("|"));
  }
  const label = language === "ja" ? "日本語Wikipedia" : "英語Wikipedia";
  try {
    const response = await fetch(`https://${language}.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return {
        available: false,
        sources: [],
        limitation: `${label}検索がHTTP ${response.status}を返した`,
      };
    }
    const payload = (await response.json()) as {
      error?: unknown;
      query?: { pages?: WikipediaPage[] };
    };
    if (payload.error) throw new Error("APIエラー");
    const matchedPages = (payload.query?.pages ?? [])
      .map((page) => ({
        title: boundedText(page.title, 200),
        url: boundedText(page.fullurl, 1_000),
        excerpt: boundedText(page.extract, 2_500),
        wikidataId: boundedText(page.pageprops?.wikibase_item, 32),
        provider: language === "ja" ? ("wikipedia_ja" as const) : ("wikipedia_en" as const),
        trustReason: trustedIds.has(boundedText(page.pageprops?.wikibase_item, 32))
          ? "照合済みWikidata項目と英語Wikipediaページの項目IDの一致を確認"
          : `${label} APIから取得し、作品名とキャラクター名の一致を確認`,
      }))
      .filter((page) => page.title && page.url.startsWith(`https://${language}.wikipedia.org/wiki/`) && page.excerpt)
      .filter((page) =>
        linkedTitles.length
          ? trustedIds.has(page.wikidataId)
          : matchesTarget(`${page.title} ${page.excerpt}`, expectedCharacter, expectedWork),
      )
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
        error instanceof Error ? `${label}検索: ${error.message.slice(0, 250)}` : `${label}検索に接続できなかった`,
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
      headers: { "User-Agent": RESEARCH_USER_AGENT },
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
      error?: unknown;
      search?: WikidataSearchResult[];
    };
    if (payload.error) throw new Error("APIエラー");
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

async function collectEnglishWikipedia(
  query: string,
  expectedCharacter: string,
  expectedWork: string,
  trustedIds: ReadonlySet<string>,
): Promise<ResearchAdapterResult> {
  if (!trustedIds.size) return collectWikipedia(query, expectedCharacter, expectedWork, "en");
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: [...trustedIds].join("|"),
    props: "sitelinks",
    sitefilter: "enwiki",
    format: "json",
  });
  try {
    const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { "User-Agent": RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      error?: unknown;
      entities?: Record<string, { sitelinks?: { enwiki?: { title?: unknown } } }>;
    };
    if (payload.error) throw new Error("APIエラー");
    const titles = [...trustedIds]
      .map((id) => boundedText(payload.entities?.[id]?.sitelinks?.enwiki?.title, 200))
      .filter(Boolean);
    return collectWikipedia(query, expectedCharacter, expectedWork, "en", titles, trustedIds);
  } catch (error) {
    const fallback = await collectWikipedia(query, expectedCharacter, expectedWork, "en");
    return {
      ...fallback,
      limitation: [
        `英語Wikipediaへの言語間リンク取得失敗: ${error instanceof Error ? error.message.slice(0, 150) : "接続失敗"}`,
        fallback.limitation,
      ]
        .filter(Boolean)
        .join("／"),
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
  const trustedIds = new Set([
    ...(wikipedia.linkedWikidataIds ?? []),
    ...wikidata.sources.map((source) => source.url.split("/").at(-1) ?? "").filter((id) => /^Q\d+$/u.test(id)),
  ]);
  const englishQuery = [`"${baseCharacterName}"`, draft.workTitle].join(" ");
  const englishWikipedia = await collectEnglishWikipedia(englishQuery, expectedCharacter, expectedWork, trustedIds);
  const adapters = [wikipedia, englishWikipedia, wikidata];
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
