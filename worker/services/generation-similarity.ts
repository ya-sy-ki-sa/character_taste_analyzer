import type { GenerationBrief } from "../../shared/generation-brief";
import type { AnyGeneratedCharacterCandidate } from "../../shared/schemas";
import { createEmbeddingProvider } from "../embedding/providers";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";
import { embedSimilarityDocuments } from "./similarity-embedding";

export type SimilarityDocument = { id: string; name: string; text: string };
export type SimilarityReport = {
  schemaVersion: "2.0";
  passed: boolean;
  comparedCount: number;
  embeddingModel: string | null;
  matches: Array<{
    sourceRef: string;
    name: string;
    nameScore: number;
    semanticScore: number | null;
    combinationScore: number;
    violated: boolean;
  }>;
};
function similarityText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(similarityText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(similarityText).join("\n");
  return "";
}
export function characterSimilarityDocument(id: string, character: AnyGeneratedCharacterCandidate): SimilarityDocument {
  return {
    id,
    name: character.identity.name,
    text: similarityText(
      Object.fromEntries(
        Object.entries(character).filter(
          ([key]) => !["schemaVersion", "briefId", "briefCoverage", "uncertainties"].includes(key),
        ),
      ),
    ),
  };
}
export function textOverlap(left: string, right: string): number {
  const grams = (text: string) => {
    const chars = [...normalizeIdentityPart(text)];
    return new Set(chars.length < 3 ? chars : chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join("")));
  };
  const a = grams(left),
    b = grams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / (a.size + b.size - intersection);
}
function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) throw new Error("EMBEDDING_DIMENSION_MISMATCH");
  const dot = left.reduce((sum, value, i) => sum + value * right[i], 0);
  const norm = Math.sqrt(
    left.reduce((sum, value) => sum + value * value, 0) * right.reduce((sum, value) => sum + value * value, 0),
  );
  return norm ? Math.max(0, Math.min(1, dot / norm)) : 0;
}
export async function loadSimilarityDocuments(
  env: Env,
  ownerUserId: string,
  domain: string,
  requestId: string,
): Promise<SimilarityDocument[]> {
  const [registered, generated] = await Promise.all([
    all<{ id: string; summary_json: string; character_name: string }>(
      env.DB.prepare(
        `SELECT s.id,(SELECT json_group_array(value_text) FROM (SELECT value_text FROM character_assertions a WHERE a.snapshot_id=s.id AND a.owner_user_id=s.owner_user_id AND a.status IN ('confirmed','corrected') ORDER BY a.ordinal,a.id)) AS summary_json,CASE WHEN s.representation_id=er.representation_id THEN json_extract(er.registration_payload_json,'$.characterName') ELSE COALESCE(json_extract(er.registration_payload_json,'$.baseCharacterName'),json_extract(er.registration_payload_json,'$.characterName')) END AS character_name FROM character_understanding_snapshots s JOIN character_understanding_runs r ON r.id=s.understanding_run_id JOIN entry_revisions er ON er.id=r.entry_revision_id JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number WHERE s.owner_user_id=? AND e.analysis_domain=? AND e.status!='archived' AND s.status IN ('confirmed','corrected','provisional_accepted')`,
      ).bind(ownerUserId, domain),
    ),
    all<{ id: string; character_json: string }>(
      env.DB.prepare(
        `SELECT c.id,c.character_json FROM generated_characters c JOIN generation_requests r ON r.id=c.generation_request_id WHERE c.owner_user_id=? AND r.analysis_domain=? AND r.id!=? UNION ALL SELECT c.id,c.character_json FROM generation_candidates c JOIN generation_requests r ON r.id=c.generation_request_id WHERE c.owner_user_id=? AND r.analysis_domain=? AND r.id!=? AND c.status='passed'`,
      ).bind(ownerUserId, domain, requestId, ownerUserId, domain, requestId),
    ),
  ]);
  return [
    ...registered.map((row) => {
      const summary = JSON.parse(row.summary_json);
      return {
        id: `entry:${row.id}`,
        name: row.character_name,
        text: [row.character_name, similarityText(summary)].join("\n"),
      };
    }),
    ...generated.map((row) => characterSimilarityDocument(`generation:${row.id}`, JSON.parse(row.character_json))),
  ];
}
export async function inspectGenerationSimilarity(
  env: Env,
  ownerUserId: string,
  brief: GenerationBrief,
  candidate: AnyGeneratedCharacterCandidate,
  documents: SimilarityDocument[],
): Promise<SimilarityReport> {
  const provider = createEmbeddingProvider(env);
  const current = characterSimilarityDocument("candidate", candidate);
  const semantic = provider.providerId !== "fake" && documents.length > 0;
  const vectors = new Map<string, number[]>();
  if (semantic) {
    const missing: Array<{ id: string; text: string; hash: string }> = [];
    for (const document of [...documents, current]) {
      const text = document.text,
        hash = await sha256Hex(text);
      const cached = await first<{ vector_json: string }>(
        env.DB.prepare(
          `SELECT vector_json FROM character_similarity_documents WHERE owner_user_id=? AND source_ref=? AND content_hash=? AND model=?`,
        ).bind(
          ownerUserId,
          document.id,
          hash,
          `${provider.providerId}:${provider.model}:${provider.dimensions ?? "default"}:full-settings-chunks-v2`,
        ),
      );
      if (cached) vectors.set(document.id, JSON.parse(cached.vector_json));
      else missing.push({ id: document.id, text, hash });
    }
    for (let offset = 0; offset < missing.length; offset += 20) {
      const batch = missing.slice(offset, offset + 20);
      const embedded = await embedSimilarityDocuments(provider, batch);
      for (const [id, values] of embedded) vectors.set(id, values);
      await env.DB.batch(
        batch.map((document) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO character_similarity_documents (id,owner_user_id,source_ref,content_hash,model,vector_json,created_at) VALUES (?,?,?,?,?,?,?)`,
          ).bind(
            crypto.randomUUID(),
            ownerUserId,
            document.id,
            document.hash,
            `${provider.providerId}:${provider.model}:${provider.dimensions ?? "default"}:full-settings-chunks-v2`,
            JSON.stringify(vectors.get(document.id)),
            nowIso(),
          ),
        ),
      );
    }
  }
  const matches = documents.map((document) => {
    const nameScore = textOverlap(current.name, document.name),
      combinationScore = textOverlap(current.text, document.text);
    const semanticScore = semantic ? cosine(vectors.get(current.id) ?? [], vectors.get(document.id) ?? []) : null;
    return {
      sourceRef: document.id,
      name: document.name,
      nameScore,
      semanticScore,
      combinationScore,
      violated:
        nameScore >= brief.similarityPolicy.nameThreshold ||
        combinationScore >= brief.similarityPolicy.combinationThreshold ||
        (semanticScore !== null && semanticScore >= brief.similarityPolicy.semanticThreshold),
    };
  });
  return {
    schemaVersion: "2.0",
    passed: !matches.some((item) => item.violated),
    comparedCount: documents.length,
    embeddingModel: semantic ? provider.model : null,
    matches: matches.filter((item) => item.violated).sort((a, b) => b.combinationScore - a.combinationScore),
  };
}
