import { normalizeIdentityPart } from "../../lib/crypto";
import type { verifyAssertionEvidence } from "./citations";
import * as repository from "./repositories/understanding";
import type { AttributeRow, UnderstandingCall } from "./types";

type VerifiedAssertion = { id: string } & Awaited<ReturnType<typeof verifyAssertionEvidence>>;

/** Return statements in commit order; the analysis workflow executes the atomic batch. */
export function understandingAssertionStatements(
  db: D1Database,
  {
    ownerUserId,
    entryRevisionId,
    snapshotId,
    value,
    verifiedAssertions,
    attributeByKey,
    now,
  }: {
    ownerUserId: string;
    entryRevisionId: string;
    snapshotId: string;
    value: UnderstandingCall["value"];
    verifiedAssertions: VerifiedAssertion[];
    attributeByKey: Map<string, AttributeRow>;
    now: string;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const [ordinal, assertion] of value.assertions.entries()) {
    const verifiedAssertion = verifiedAssertions[ordinal];
    const assertionId = verifiedAssertion.id;
    const rawId = crypto.randomUUID();
    const attribute = assertion.attributeStableKey ? attributeByKey.get(assertion.attributeStableKey) : undefined;
    statements.push(
      repository.insertRawAttributeMentions(db, [
        rawId,
        ownerUserId,
        assertionId,
        assertion.rawLabel,
        assertion.valueText,
        normalizeIdentityPart(assertion.rawLabel),
        now,
      ]),
    );
    statements.push(
      repository.insertAttributeMappings(db, [
        crypto.randomUUID(),
        rawId,
        attribute?.id ?? null,
        attribute ? "accepted" : "unmapped",
        attribute ? "exact" : "llm",
        attribute ? 1 : assertion.confidence,
        now,
        attribute ? now : null,
      ]),
    );
    statements.push(
      repository.insertCharacterAssertions(db, [
        assertionId,
        ownerUserId,
        snapshotId,
        attribute?.id ?? null,
        rawId,
        assertion.rawLabel,
        assertion.valueText,
        assertion.assertionKind,
        JSON.stringify({
          schemaVersion: "1",
          freeText: assertion.scopeText,
        }),
        assertion.explicitness,
        assertion.explicitness === "model_knowledge" ? Math.min(0.45, assertion.confidence) : assertion.confidence,
        ordinal,
        now,
      ]),
    );
    for (const verified of verifiedAssertion.evidence) {
      statements.push(
        repository.insertEvidenceFragments(db, [
          crypto.randomUUID(),
          ownerUserId,
          assertionId,
          verified.sourceId,
          verified.evidenceOrigin,
          verified.quoteStart,
          verified.quoteEnd,
          verified.quoteHash,
          verified.excerptText,
          verified.inputPointer,
          assertion.confidence,
          verified.verificationStatus,
          verified.inferenceType,
          now,
        ]),
      );
    }
  }
  for (const [ordinal, delta] of value.customizationDeltas.entries()) {
    const attribute = delta.targetAttributeStableKey ? attributeByKey.get(delta.targetAttributeStableKey) : undefined;
    statements.push(
      repository.insertCustomizationDeltas(db, [
        crypto.randomUUID(),
        ownerUserId,
        snapshotId,
        delta.operation,
        attribute?.id ?? null,
        delta.beforeValue,
        delta.afterValue,
        JSON.stringify({ schemaVersion: "1", freeText: delta.scopeText }),
        delta.reasonText,
        delta.explicitness,
        delta.confidence,
        ordinal,
        now,
      ]),
    );
  }
  if ("transformationDeltas" in value) {
    for (const [ordinal, delta] of value.transformationDeltas.entries())
      statements.push(
        repository.insertDarkTransformationDeltas(db, [
          crypto.randomUUID(),
          ownerUserId,
          entryRevisionId,
          snapshotId,
          delta.operation,
          delta.aspect,
          delta.beforeValue,
          delta.afterValue,
          JSON.stringify({
            cause: delta.cause,
            agencyOrigin: delta.agencyOrigin,
            controller: delta.controller,
            awareness: delta.awareness,
            resistance: delta.resistance,
            identityContinuity: delta.identityContinuity,
            responsibility: delta.responsibility,
            reversibility: delta.reversibility,
            phase: delta.phase,
            evidence: delta.evidence,
          }),
          delta.confidence,
          ordinal,
          now,
        ]),
      );
  }
  return statements;
}
