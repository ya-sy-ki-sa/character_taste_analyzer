import { nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";
import type { ProvenanceSource } from "./provenance-verifier";

export {
  ProvenanceVerificationError,
  verifyEvidenceReference,
} from "./provenance-verifier";

export async function loadInputProvenanceSources(env: Env, sourceSetId: string | null): Promise<ProvenanceSource[]> {
  if (!sourceSetId) return [];
  const sources = await all<{
    id: string;
    locator_json: string;
    text_content: string;
    source_type: string;
    citation_json: string;
  }>(
    env.DB.prepare(
      `
      SELECT s.id,s.locator_json,s.text_content,s.source_type,s.citation_json FROM source_set_items ssi
      JOIN sources s ON s.id=ssi.source_id
      WHERE ssi.source_set_id=?
        AND (NOT EXISTS (
          SELECT 1 FROM evidence_fragments e WHERE e.source_id=s.id AND e.evidence_origin='review'
        ) OR EXISTS (
          SELECT 1 FROM evidence_fragments e JOIN character_assertions a
            ON e.owner_type='character_assertion' AND a.id=e.owner_id AND a.owner_user_id=s.owner_user_id
          WHERE e.source_id=s.id AND e.evidence_origin='review' AND a.status IN ('confirmed','corrected')
        ))
      ORDER BY ssi.priority,s.id
    `,
    ).bind(sourceSetId),
  );
  return sources.map((source) => {
    const locator = JSON.parse(source.locator_json) as Record<string, unknown>;
    const citation = JSON.parse(source.citation_json) as Record<string, unknown>;
    return {
      sourceId: source.id,
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
  sourceSetId: string | null,
  sources: Array<{
    url: string;
    title: string;
    excerpt?: string;
    provider?: string;
    trustReason?: string;
  }>,
): Promise<{ sources: ProvenanceSource[]; statements: D1PreparedStatement[] }> {
  const result: ProvenanceSource[] = [];
  const prepared: D1PreparedStatement[] = [];
  for (const source of new Map(sources.map((item) => [item.url, item])).values()) {
    const now = nowIso();
    const existing = await first<{
      source_id: string;
      text_content: string;
      citation_json: string;
    }>(
      env.DB.prepare(
        `
        SELECT id AS source_id,citation_json,text_content
        FROM sources
        WHERE owner_user_id=? AND json_extract(citation_json,'$.url')=? LIMIT 1
      `,
      ).bind(ownerUserId, source.url),
    );
    if (existing) {
      if (source.provider || source.trustReason) {
        const citation = JSON.parse(existing.citation_json) as Record<string, unknown>;
        const updatedCitation = {
          ...citation,
          ...(source.provider ? { provider: source.provider } : {}),
          ...(source.trustReason ? { trustReason: source.trustReason } : {}),
        };
        if (JSON.stringify(updatedCitation) !== JSON.stringify(citation)) {
          prepared.push(
            env.DB.prepare(
              `UPDATE sources SET citation_json=?,updated_at=?
               WHERE id=? AND owner_user_id=?`,
            ).bind(JSON.stringify(updatedCitation), now, existing.source_id, ownerUserId),
          );
        }
      }
      if (sourceSetId)
        prepared.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO source_set_items
              (source_set_id,source_id,priority,usage_type)
             VALUES (?,?,100,'supporting')`,
          ).bind(sourceSetId, existing.source_id),
        );
      result.push({
        sourceId: existing.source_id,
        text: existing.text_content,
        inputPointer: null,
        url: source.url,
        origin: "source",
      });
      continue;
    }
    const documentId = crypto.randomUUID();
    const text = source.excerpt?.trim() || source.title;
    const hash = await sha256Hex(text);
    prepared.push(
      env.DB.prepare(
        `INSERT INTO sources
          (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,
           locator_json,text_content,token_estimate,created_at,updated_at)
         VALUES (?,?,?,'secondary',?,'public_web_excerpt','text/plain',?,?,?,?,?,?,?)`,
      ).bind(
        documentId,
        ownerUserId,
        source.title,
        JSON.stringify({
          url: source.url,
          title: source.title,
          provider: source.provider ?? null,
          trustReason: source.trustReason ?? null,
        }),
        new TextEncoder().encode(text).byteLength,
        hash,
        JSON.stringify({ type: "url", url: source.url }),
        text,
        Math.ceil(text.length / 3),
        now,
        now,
      ),
    );
    if (sourceSetId)
      prepared.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO source_set_items (source_set_id,source_id,priority,usage_type)
           VALUES (?,?,100,'supporting')`,
        ).bind(sourceSetId, documentId),
      );
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
