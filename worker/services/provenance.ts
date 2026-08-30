import { nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";
import type { ProvenanceSource } from "./provenance-verifier";

export { verifyEvidenceReference } from "./provenance-verifier";

export async function loadInputProvenanceSources(
  env: Env,
  sourceSetVersionId: string | null,
): Promise<ProvenanceSource[]> {
  if (!sourceSetVersionId) return [];
  const sources = await all<{
    id: string;
    locator_json: string;
    text_content: string;
    source_type: string;
    citation_json: string;
  }>(
    env.DB.prepare(`
      SELECT sf.id,sf.locator_json,sf.text_content,sd.source_type,sd.citation_json FROM source_set_items ssi
      JOIN source_fragments sf ON sf.source_document_revision_id=ssi.source_document_revision_id
      JOIN source_documents sd ON sd.id=(SELECT source_document_id FROM source_document_revisions WHERE id=sf.source_document_revision_id)
      WHERE ssi.source_set_version_id=?
      ORDER BY ssi.priority,sf.ordinal
    `).bind(sourceSetVersionId),
  );
  return sources.map((source) => {
    const locator = JSON.parse(source.locator_json) as Record<string, unknown>;
    const citation = JSON.parse(source.citation_json) as Record<string, unknown>;
    return {
      fragmentId: source.id,
      text: source.text_content,
      inputPointer: typeof locator.pointer === "string" ? locator.pointer : null,
      url: typeof citation.url === "string" ? citation.url : null,
      origin: source.source_type === "user_text" ? ("user_input" as const) : ("source" as const),
    };
  });
}

export async function prepareExternalProvenanceSources(
  env: Env,
  ownerUserId: string,
  sourceSetVersionId: string | null,
  sources: Array<{ url: string; title: string; excerpt?: string }>,
): Promise<{ sources: ProvenanceSource[]; statements: D1PreparedStatement[] }> {
  const result: ProvenanceSource[] = [];
  const prepared: D1PreparedStatement[] = [];
  for (const source of new Map(sources.map((item) => [item.url, item])).values()) {
    const existing = await first<{ fragment_id: string; revision_id: string; text_content: string }>(
      env.DB.prepare(`
        SELECT sf.id AS fragment_id,sr.id AS revision_id,sf.text_content FROM source_documents sd
        JOIN source_document_revisions sr ON sr.source_document_id=sd.id AND sr.revision_number=sd.active_revision_number
        JOIN source_fragments sf ON sf.source_document_revision_id=sr.id AND sf.ordinal=0
        WHERE sd.owner_user_id=? AND json_extract(sd.citation_json,'$.url')=? LIMIT 1
      `).bind(ownerUserId, source.url),
    );
    if (existing) {
      if (sourceSetVersionId)
        prepared.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO source_set_items
              (source_set_version_id,source_document_revision_id,priority,usage_type)
             VALUES (?,?,100,'supporting')`,
          ).bind(sourceSetVersionId, existing.revision_id),
        );
      result.push({
        fragmentId: existing.fragment_id,
        text: existing.text_content,
        inputPointer: null,
        url: source.url,
        origin: "source",
      });
      continue;
    }
    const documentId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fragmentId = crypto.randomUUID();
    const text = source.excerpt?.trim() || source.title;
    const hash = await sha256Hex(text);
    const now = nowIso();
    prepared.push(
      env.DB.prepare(
        `INSERT INTO source_documents (id,owner_user_id,title,source_type,visibility,citation_json,rights_basis,active_revision_number,revision,created_at,updated_at)
         VALUES (?,?,?,'secondary','private',?,'public_web_excerpt',1,1,?,?)`,
      ).bind(documentId, ownerUserId, source.title, JSON.stringify({ url: source.url, title: source.title }), now, now),
      env.DB.prepare(
        `INSERT INTO source_document_revisions (id,source_document_id,revision_number,inline_text,mime_type,byte_size,content_hash,upload_status,extraction_status,finalized_at,created_at)
         VALUES (?,?,1,?,'text/plain',?,?,'finalized','ready',?,?)`,
      ).bind(revisionId, documentId, text, new TextEncoder().encode(text).byteLength, hash, now, now),
      env.DB.prepare(
        `INSERT INTO source_fragments (id,source_document_revision_id,ordinal,locator_json,text_content,content_hash,token_estimate,created_at)
         VALUES (?,?,0,?,?,?,?,?)`,
      ).bind(
        fragmentId,
        revisionId,
        JSON.stringify({ type: "url", url: source.url }),
        text,
        hash,
        Math.ceil(text.length / 3),
        now,
      ),
    );
    if (sourceSetVersionId)
      prepared.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO source_set_items (source_set_version_id,source_document_revision_id,priority,usage_type)
           VALUES (?,?,100,'supporting')`,
        ).bind(sourceSetVersionId, revisionId),
      );
    result.push({ fragmentId, text, inputPointer: null, url: source.url, origin: "source" });
  }
  return { sources: result, statements: prepared };
}

export async function persistExternalProvenanceSources(
  env: Env,
  ownerUserId: string,
  sourceSetVersionId: string | null,
  sources: Array<{ url: string; title: string; excerpt?: string }>,
): Promise<ProvenanceSource[]> {
  const prepared = await prepareExternalProvenanceSources(env, ownerUserId, sourceSetVersionId, sources);
  if (prepared.statements.length) {
    const saved = await env.DB.batch(prepared.statements);
    if (saved.some((item) => !item.success)) throw new Error("D1_PROVENANCE_SOURCE_FAILED");
  }
  return prepared.sources;
}
