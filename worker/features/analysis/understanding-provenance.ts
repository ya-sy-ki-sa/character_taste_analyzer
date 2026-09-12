import type { DocumentLoader } from "../../platform/provenance/document";
import { CitationRegistry } from "../../platform/provenance/registry";
import { loadInputProvenanceSources, prepareExternalProvenanceSources } from "../../platform/provenance/sources";
import { canonicalSourceUrl } from "../../platform/provenance/urls";
import type { Env } from "../../types";
import type { CharacterResearch } from "./research";
import type { EntryContext, UnderstandingCall } from "./types";

/** Preview and persistence must resolve the same collected text and citation identities. No writes here. */
export async function prepareUnderstandingProvenance(
  env: Env,
  entry: EntryContext,
  research: CharacterResearch,
  citations: NonNullable<UnderstandingCall["metadata"]["citations"]>,
  loadDocument?: DocumentLoader,
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
    loadDocument,
  );
  const refreshedUrls = new Set(externalProvenance.sources.map((source) => canonicalSourceUrl(source.url ?? "")));
  const inputs = await loadInputProvenanceSources(env, entry.sourceSetId);
  const sources = [
    ...inputs.filter((source) => !source.url || !refreshedUrls.has(canonicalSourceUrl(source.url))),
    ...externalProvenance.sources,
  ];
  const allowedUrls = new Set(externalSources.map((source) => source.url));
  const registry = new CitationRegistry();
  await registry.add(externalSources);
  return { sources, allowedUrls, registry, statements: externalProvenance.statements };
}
