import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyPreferenceCandidate } from "../../../shared/contracts/preference";
import { normalizeIdentityPart } from "../../lib/crypto";
import type { verifyAssertionEvidence } from "./citations";
import * as repository from "./repositories/preference";
import type { AttributeRow, EntryContext } from "./types";

type VerifiedAssertion = { id: string } & Awaited<ReturnType<typeof verifyAssertionEvidence>>;

/** Return statements without changing the workflow's commit fence or batch boundary. */
export function preferenceAssertionStatements(
  db: D1Database,
  {
    ownerUserId,
    analysisDomain,
    entry,
    runId,
    value,
    verifiedPreferences,
    verifiedStances,
    ontology,
    now,
  }: {
    ownerUserId: string;
    analysisDomain: AnalysisDomain;
    entry: Pick<EntryContext, "entryRevisionId" | "characterIdentityId" | "representationId">;
    runId: string;
    value: AnyPreferenceCandidate;
    verifiedPreferences: VerifiedAssertion[];
    verifiedStances: VerifiedAssertion[];
    ontology: AttributeRow[];
    now: string;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const attributeByKey = new Map(ontology.map((item) => [item.stable_key, item]));
  for (const [index, assertion] of value.preferenceAssertions.entries()) {
    const verifiedAssertion = verifiedPreferences[index];
    const id = verifiedAssertion.id;
    const rawId = crypto.randomUUID();
    const attribute = assertion.attributeStableKey ? attributeByKey.get(assertion.attributeStableKey) : undefined;
    statements.push(
      repository.insertRawAttributeMentions(db, [
        rawId,
        ownerUserId,
        id,
        assertion.rawLabel,
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
      repository.insertPreferenceAssertions(db, [
        id,
        ownerUserId,
        runId,
        entry.entryRevisionId,
        entry.characterIdentityId,
        entry.representationId,
        attribute?.id ?? null,
        rawId,
        analysisDomain,
        assertion.polarity,
        assertion.responseChannel,
        assertion.strength,
        assertion.explicitness,
        assertion.explicitness === "model_knowledge" ? Math.min(0.45, assertion.confidence) : assertion.confidence,
        JSON.stringify(assertion.context),
        now,
      ]),
    );
    for (const verified of verifiedAssertion.evidence) {
      statements.push(
        repository.insertPreferenceEvidence(db, [
          crypto.randomUUID(),
          ownerUserId,
          id,
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
  for (const [index, stance] of value.valueStanceAssertions.entries()) {
    const verifiedAssertion = verifiedStances[index];
    const id = verifiedAssertion.id;
    statements.push(
      repository.insertValueStanceAssertions(db, [
        id,
        ownerUserId,
        runId,
        stance.targetType,
        stance.targetRef,
        stance.stance,
        stance.orientation,
        JSON.stringify(stance.context),
        stance.explicitness,
        stance.confidence,
        now,
      ]),
    );
    for (const verified of verifiedAssertion.evidence) {
      statements.push(
        repository.insertValueStanceEvidence(db, [
          crypto.randomUUID(),
          ownerUserId,
          id,
          verified.sourceId,
          verified.evidenceOrigin,
          verified.quoteStart,
          verified.quoteEnd,
          verified.quoteHash,
          verified.excerptText,
          verified.inputPointer,
          stance.confidence,
          verified.verificationStatus,
          verified.inferenceType,
          now,
        ]),
      );
    }
  }
  return statements;
}
