import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import { deriveUuid, nowIso, sha256Hex } from "../../lib/crypto";
import { all } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/confirmed-understanding";

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
    }>(repository.selectCharacterAssertions(env.DB, [snapshotId, ownerUserId])),
    all<{
      owner_id: string;
      evidence_origin: string;
      user_input_path: string | null;
      excerpt_text: string | null;
      inference_type: "direct" | "paraphrase" | "inferred";
      citation_json: string | null;
    }>(repository.selectEvidenceFragments(env.DB, [snapshotId, ownerUserId])),
    all<{
      operation: Delta["operation"];
      stable_key: string | null;
      before_value: string | null;
      after_value: string | null;
      scope_json: string;
      reason_text: string | null;
      explicitness: Delta["explicitness"];
      confidence: number;
    }>(repository.selectCustomizationDeltas(env.DB, [snapshotId, ownerUserId])),
    all<{ raw_label: string; value_text: string; status: string }>(
      repository.selectCharacterAssertions2(env.DB, [snapshotId, ownerUserId]),
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
    repository.insertSources(env.DB, [
      id,
      ownerUserId,
      new TextEncoder().encode(valueText).byteLength,
      await sha256Hex(valueText),
      JSON.stringify({ pointer }),
      valueText,
      Math.ceil(valueText.length / 3),
      now,
      now,
    ]),
    ...(sourceSetId ? [repository.insertSourceSetItems(env.DB, [sourceSetId, id])] : []),
    repository.insertEvidenceFragments(env.DB, [
      crypto.randomUUID(),
      ownerUserId,
      assertionId,
      id,
      valueText,
      pointer,
      now,
    ]),
  ];
}
