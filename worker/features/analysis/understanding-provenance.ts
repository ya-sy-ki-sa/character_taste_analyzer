import { CitationRegistry } from "../../platform/provenance/registry";
import { loadInputProvenanceSources, prepareExternalProvenanceSources } from "../../platform/provenance/sources";
import type { Env } from "../../types";
import type { CharacterResearch } from "./research";
import type { EntryContext, UnderstandingCall } from "./types";

/** Preview and persistence must resolve the same collected text and citation identities. No writes here. */
export async function prepareUnderstandingProvenance(
  env: Env,
  entry: EntryContext,
  research: CharacterResearch,
  citations: NonNullable<UnderstandingCall["metadata"]["citations"]>,
) {
  const externalSources = [
    ...research.sources,
    ...citations.map((item) => ({
      ...item,
      excerpt: undefined,
      provider: "openai_web_search",
      trustReason: "OpenAI Web Searchの参照元または引用注釈として応答に含まれたURL",
    })),
  ];
  const externalProvenance = await prepareExternalProvenanceSources(
    env,
    entry.ownerUserId,
    entry.sourceSetId,
    externalSources,
  );
  const sources = [...(await loadInputProvenanceSources(env, entry.sourceSetId)), ...externalProvenance.sources];
  const allowedUrls = new Set(externalSources.map((source) => source.url));
  const registry = new CitationRegistry();
  await registry.add(externalSources);
  return { sources, allowedUrls, registry, statements: externalProvenance.statements };
}
