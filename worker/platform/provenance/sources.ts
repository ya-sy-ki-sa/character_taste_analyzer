import { nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import type { DocumentLoader } from "./document";
import * as repository from "./repositories/sources";
import { canonicalSourceUrl } from "./urls";
import type { ProvenanceSource } from "./verifier";

export {
  ProvenanceVerificationError,
  verifyEvidenceReference,
} from "./verifier";

/** Keep fetched external bodies out of model context without changing verification sources. */
export function provenanceForPrompt(sources: ProvenanceSource[]): ProvenanceSource[] {
  return sources.map((source) => (source.url && source.origin === "source" ? { ...source, text: "" } : source));
}

export async function loadInputProvenanceSources(env: Env, sourceSetId: string | null): Promise<ProvenanceSource[]> {
  if (!sourceSetId) return [];
  const sources = await all<{
    id: string;
    locator_json: string;
    text_content: string;
    source_type: string;
    citation_json: string;
  }>(repository.selectSourceSetItems(env.DB, [sourceSetId]));
  return sources.map((source) => {
    const locator = JSON.parse(source.locator_json) as Record<string, unknown>;
    const citation = JSON.parse(source.citation_json) as Record<string, unknown>;
    return {
      sourceId: source.id,
      text:
        source.source_type !== "user_text" &&
        (citation.textAvailable === false ||
          (citation.textAvailable !== true &&
            (source.text_content === citation.title || source.text_content === citation.url)))
          ? ""
          : source.text_content,
      inputPointer: typeof locator.pointer === "string" ? locator.pointer : null,
      url: typeof citation.url === "string" ? citation.url : null,
      origin: source.source_type === "user_text" ? ("user_input" as const) : ("source" as const),
    };
  });
}

export async function prepareExternalProvenanceSources(
  env: Env,
  ownerUserId: string,
  sourceSetId: string | null,
  sources: Array<{
    url: string;
    title: string;
    excerpt?: string;
    provider?: string;
    trustReason?: string;
  }>,
  loadDocument?: DocumentLoader,
): Promise<{ sources: ProvenanceSource[]; statements: D1PreparedStatement[] }> {
  const result: ProvenanceSource[] = [];
  const prepared: D1PreparedStatement[] = [];
  const unique = new Map<string, (typeof sources)[number]>();
  for (const source of sources) {
    const key = canonicalSourceUrl(source.url);
    const previous = unique.get(key);
    // Search annotations often repeat a collected document with only a title.
    // Keep its collected text so exact quotes remain verifiable.
    if (!previous || (!previous.excerpt?.trim() && source.excerpt?.trim())) unique.set(key, source);
  }
  for (const source of unique.values()) {
    const now = nowIso();
    const existing = await first<{
      source_id: string;
      text_content: string;
      citation_json: string;
    }>(repository.selectSources(env.DB, [ownerUserId, source.url]));
    const citation = existing ? (JSON.parse(existing.citation_json) as Record<string, unknown>) : {};
    const existingText =
      existing &&
      citation.textAvailable !== false &&
      (citation.textAvailable === true ||
        (existing.text_content !== citation.title && existing.text_content !== citation.url))
        ? existing.text_content
        : "";
    const document = existingText
      ? // Preserve stored quote offsets in documents already used by earlier registrations.
        {
          text: existingText,
          status: typeof citation.documentStatus === "string" ? citation.documentStatus : "stored_excerpt",
        }
      : await loadDocument?.(source.url);
    const excerpt = source.excerpt?.trim() ?? "";
    const text = document?.text || (excerpt.length > existingText.length ? excerpt : existingText);
    const storedText = text || source.title || source.url;
    const updatedCitation = {
      ...citation,
      url: source.url,
      title: source.title,
      provider: source.provider ?? citation.provider ?? null,
      trustReason: source.trustReason ?? citation.trustReason ?? null,
      documentStatus: document?.status ?? "not_fetched",
      textAvailable: Boolean(text),
    };
    if (existing) {
      if (storedText !== existing.text_content || JSON.stringify(updatedCitation) !== JSON.stringify(citation)) {
        prepared.push(
          repository.updateSourceDocument(env.DB, [
            JSON.stringify(updatedCitation),
            storedText,
            new TextEncoder().encode(storedText).byteLength,
            await sha256Hex(storedText),
            Math.ceil(storedText.length / 3),
            now,
            existing.source_id,
            ownerUserId,
          ]),
        );
      }
      if (sourceSetId) prepared.push(repository.insertSourceSetItems(env.DB, [sourceSetId, existing.source_id]));
      result.push({ sourceId: existing.source_id, text, inputPointer: null, url: source.url, origin: "source" });
      continue;
    }
    const documentId = crypto.randomUUID();
    const hash = await sha256Hex(storedText);
    prepared.push(
      repository.insertSources(env.DB, [
        documentId,
        ownerUserId,
        source.title,
        JSON.stringify(updatedCitation),
        new TextEncoder().encode(storedText).byteLength,
        hash,
        JSON.stringify({ type: "url", url: source.url }),
        storedText,
        Math.ceil(storedText.length / 3),
        now,
        now,
      ]),
    );
    if (sourceSetId) prepared.push(repository.insertSourceSetItems(env.DB, [sourceSetId, documentId]));
    result.push({
      sourceId: documentId,
      text,
      inputPointer: null,
      url: source.url,
      origin: "source",
    });
  }
  return { sources: result, statements: prepared };
}

export async function persistExternalProvenanceSources(
  env: Env,
  ownerUserId: string,
  sourceSetId: string | null,
  sources: Array<{
    url: string;
    title: string;
    excerpt?: string;
    provider?: string;
    trustReason?: string;
  }>,
): Promise<ProvenanceSource[]> {
  const prepared = await prepareExternalProvenanceSources(env, ownerUserId, sourceSetId, sources);
  if (prepared.statements.length) {
    const saved = await env.DB.batch(prepared.statements);
    if (saved.some((item) => !item.success)) throw new Error("D1_PROVENANCE_SOURCE_FAILED");
  }
  return prepared.sources;
}
