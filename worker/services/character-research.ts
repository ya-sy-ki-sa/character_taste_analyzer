import { type EntryDraft, entryBaseCharacterName } from "../../shared/schemas";
import { normalizeIdentityPart } from "../lib/crypto";
import type { Env } from "../types";

export type CharacterResearchSource = {
  title: string;
  url: string;
  excerpt: string;
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
};

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

export async function collectCharacterResearch(env: Env, draft: EntryDraft): Promise<CharacterResearch> {
  if (draft.registrationType === "original") return { status: "not_applicable", sources: [] };
  if (env.LLM_PROVIDER === "replay" || env.LLM_PROVIDER === "fake") {
    return { status: "disabled", sources: [], limitation: "決定論的テストでは外部検索を行わない" };
  }

  const baseCharacterName = entryBaseCharacterName(draft);
  const query = [draft.workTitle, baseCharacterName, draft.mediaType].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "4",
    prop: "extracts|info",
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
        status: "unavailable",
        query,
        sources: [],
        limitation: `公開情報検索がHTTP ${response.status}を返した`,
      };
    }
    const payload = (await response.json()) as { query?: { pages?: WikipediaPage[] } };
    const expectedCharacter = normalizeIdentityPart(baseCharacterName);
    const expectedWork = normalizeIdentityPart(draft.workTitle);
    const sources = (payload.query?.pages ?? [])
      .map((page) => ({
        title: boundedText(page.title, 200),
        url: boundedText(page.fullurl, 1_000),
        excerpt: boundedText(page.extract, 2_500),
      }))
      .filter((page) => page.title && page.url && page.excerpt)
      .filter((page) => {
        const searchable = normalizeIdentityPart(`${page.title} ${page.excerpt}`);
        return searchable.includes(expectedCharacter) && searchable.includes(expectedWork);
      })
      .slice(0, 4);
    return sources.length
      ? { status: "collected", query, sources }
      : { status: "not_found", query, sources: [], limitation: "公開情報検索で一致する説明を取得できなかった" };
  } catch (error) {
    return {
      status: "unavailable",
      query,
      sources: [],
      limitation: error instanceof Error ? error.message.slice(0, 300) : "公開情報検索に接続できなかった",
    };
  }
}
