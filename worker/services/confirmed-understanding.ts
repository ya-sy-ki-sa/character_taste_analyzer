import type { UnderstandingCandidate } from "../../shared/schemas";
import { deriveUuid, nowIso, sha256Hex } from "../lib/crypto";
import { all } from "../lib/db";
import type { Env } from "../types";

type Assertion = UnderstandingCandidate["assertions"][number];
type Delta = UnderstandingCandidate["customizationDeltas"][number];

export async function loadConfirmedUnderstanding(env: Env, ownerUserId: string, snapshotId: string) {
  const [rows, evidence, deltas, excluded] = await Promise.all([
    all<{
      id: string;
      raw_label: string;
      value_text: string;
      stable_key: string | null;
      assertion_kind: Assertion["assertionKind"];
      scope_json: string;
      explicitness: Assertion["explicitness"];
      confidence: number;
    }>(
      env.DB.prepare(
        `SELECT a.*,d.stable_key FROM character_assertions a LEFT JOIN attribute_definitions d ON d.id=a.attribute_definition_id WHERE a.snapshot_id=? AND a.owner_user_id=? AND a.status IN ('confirmed','corrected') ORDER BY a.ordinal,a.id`,
      ).bind(snapshotId, ownerUserId),
    ),
    all<{
      owner_id: string;
      evidence_origin: string;
      user_input_path: string | null;
      excerpt_text: string | null;
      inference_type: "direct" | "paraphrase" | "inferred";
      citation_json: string | null;
    }>(
      env.DB.prepare(
        `SELECT e.*,s.citation_json FROM evidence_fragments e LEFT JOIN sources s ON s.id=e.source_id JOIN character_assertions a ON a.id=e.owner_id AND e.owner_type='character_assertion' WHERE a.snapshot_id=? AND e.owner_user_id=? AND e.verification_status!='invalid' ORDER BY e.created_at,e.id`,
      ).bind(snapshotId, ownerUserId),
    ),
    all<{
      operation: Delta["operation"];
      stable_key: string | null;
      before_value: string | null;
      after_value: string | null;
      scope_json: string;
      reason_text: string | null;
      explicitness: Delta["explicitness"];
      confidence: number;
    }>(
      env.DB.prepare(
        `SELECT c.*,d.stable_key FROM customization_deltas c LEFT JOIN attribute_definitions d ON d.id=c.target_attribute_id WHERE c.snapshot_id=? AND c.owner_user_id=? AND c.status IN ('confirmed','corrected') ORDER BY c.ordinal,c.id`,
      ).bind(snapshotId, ownerUserId),
    ),
    all<{ raw_label: string; value_text: string; status: string }>(
      env.DB.prepare(
        `SELECT raw_label,value_text,status FROM character_assertions WHERE snapshot_id=? AND owner_user_id=? AND status IN ('rejected','superseded') ORDER BY ordinal,id`,
      ).bind(snapshotId, ownerUserId),
    ),
  ]);
  return {
    excluded,
    rows,
    assertions: rows.map(
      (row): Assertion => ({
        attributeStableKey: row.stable_key,
        rawLabel: row.raw_label,
        valueText: row.value_text,
        assertionKind: row.assertion_kind,
        scopeText: JSON.parse(row.scope_json).freeText ?? null,
        explicitness: row.explicitness,
        confidence: row.confidence,
        evidence: evidence
          .filter((item) => item.owner_id === row.id)
          .slice(0, 3)
          .map((item) => {
            const url = JSON.parse(item.citation_json ?? "{}").url ?? null;
            return {
              sourceRef: item.user_input_path
                ? `input:${item.user_input_path.slice(1)}`
                : item.evidence_origin === "model_knowledge"
                  ? "model_knowledge"
                  : (url ?? "confirmed_review"),
              sourceUrl: url,
              inputPointer: item.user_input_path,
              quote: item.excerpt_text,
              inferenceType: item.inference_type,
            };
          }),
      }),
    ),
    customizationDeltas: deltas.map(
      (row): Delta => ({
        operation: row.operation,
        targetAttributeStableKey: row.stable_key,
        beforeValue: row.before_value,
        afterValue: row.after_value,
        scopeText: JSON.parse(row.scope_json).freeText ?? null,
        reasonText: row.reason_text,
        explicitness: row.explicitness,
        confidence: row.confidence,
      }),
    ),
  };
}

/** Persist each review edit and its provenance in the same batch. */
export async function confirmedReviewSourceStatements(
  env: Env,
  ownerUserId: string,
  assertionId: string,
  valueText: string,
  sourceSetId: string | null,
): Promise<D1PreparedStatement[]> {
  const id = await deriveUuid(env.AUTH_PEPPER, `review-source:${ownerUserId}:${assertionId}`);
  const now = nowIso();
  const pointer = `/confirmedUnderstanding/assertions/${assertionId}/valueText`;
  return [
    env.DB.prepare(
      `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,'確認時の訂正','user_text','{}','user_provided','text/plain',?,?,?,?,?,?,?)`,
    ).bind(
      id,
      ownerUserId,
      new TextEncoder().encode(valueText).byteLength,
      await sha256Hex(valueText),
      JSON.stringify({ pointer }),
      valueText,
      Math.ceil(valueText.length / 3),
      now,
      now,
    ),
    ...(sourceSetId
      ? [
          env.DB.prepare(
            `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,0,'user_definition')`,
          ).bind(sourceSetId, id),
        ]
      : []),
    env.DB.prepare(
      `INSERT INTO evidence_fragments (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,excerpt_text,user_input_path,verification_status,inference_type,confidence,created_at) VALUES (?,?,'character_assertion',?,?,'review','supports',?,?,'verified_quote','direct',1,?)`,
    ).bind(crypto.randomUUID(), ownerUserId, assertionId, id, valueText, pointer, now),
  ];
}
