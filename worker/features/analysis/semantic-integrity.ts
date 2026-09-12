import type { CitationIssue } from "../../../shared/contracts/citations";
import type {
  AuditedEvidence,
  EvidenceSetAssessment,
  ScopedProposition,
} from "../../../shared/contracts/semantic-audit";
import { SEMANTIC_AUDIT_POLICY } from "../../llm/prompts/semantic-audit";
import type { CitationRegistry } from "../../platform/provenance/registry";
import { type ProvenanceSource, verifyEvidenceReference } from "../../platform/provenance/verifier";
import { verifyAssertionEvidence } from "./citations";

type Assertion = {
  evidence: AuditedEvidence[];
  scopeAssessment: ScopedProposition;
  evidenceSetAssessment?: EvidenceSetAssessment | null;
  confidence: number;
  explicitness: string;
};
export async function verifySemanticAssertion(
  assertion: Assertion,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
  registry: CitationRegistry,
  target: Pick<CitationIssue, "targetType" | "targetId" | "modelRunId">,
  issues: CitationIssue[],
) {
  const verified = await verifyAssertionEvidence(assertion, sources, allowedUrls, registry, target, issues);
  const anchors = await Promise.all(
    assertion.scopeAssessment.anchors.map((anchor) => verifyEvidenceReference(anchor, sources, allowedUrls, registry)),
  );
  const character = target.targetType === "character_assertion";
  const individuallySupportedIndexes = verified.evidence.flatMap((proof, index) => {
    const support = assertion.evidence[index].supportAssessment.verdict;
    return support === "supported" &&
      ["verified_quote", "source_attributed"].includes(proof.verificationStatus) &&
      (character || proof.evidenceOrigin === "user_input")
      ? [index]
      : [];
  });
  const evidenceSet = assertion.evidenceSetAssessment;
  const setIndexes = evidenceSet?.evidenceIndexes ?? [];
  const validSet =
    evidenceSet?.verdict === "supported" &&
    setIndexes.length > 0 &&
    setIndexes.length <= 3 &&
    new Set(setIndexes).size === setIndexes.length &&
    setIndexes.every((index) => {
      const proof = verified.evidence[index];
      return (
        Number.isInteger(index) &&
        proof &&
        ["supported", "partial"].includes(assertion.evidence[index].supportAssessment.verdict) &&
        ["verified_quote", "source_attributed"].includes(proof.verificationStatus) &&
        (character || proof.evidenceOrigin === "user_input")
      );
    });
  // A failed whole-claim assessment cannot fall back to a single quote or model knowledge.
  const supportedIndexes = evidenceSet ? (validSet ? setIndexes : []) : individuallySupportedIndexes;
  // Only a deliberately separate model-knowledge reference can survive as model knowledge.
  const modelIndexes =
    character && !evidenceSet
      ? verified.evidence.flatMap((proof, index) => {
          const ref = assertion.evidence[index];
          return ref.sourceRef === "model_knowledge" &&
            !ref.sourceUrl &&
            !ref.inputPointer &&
            ref.inferenceType !== "direct" &&
            proof.verificationStatus === "model_knowledge" &&
            ref.supportAssessment.verdict === "unverifiable"
            ? [index]
            : [];
        })
      : [];
  const anchored = anchors.some(
    (proof) => proof.verificationStatus === "verified_quote" && (character || proof.evidenceOrigin === "user_input"),
  );
  const scopeConsistent =
    assertion.scopeAssessment.verdict === "consistent" &&
    (anchored || (character && modelIndexes.length > 0 && assertion.scopeAssessment.anchors.length === 0));
  const keep = Boolean(scopeConsistent && (supportedIndexes.length || modelIndexes.length));
  let explicitness = assertion.explicitness;
  let confidence = keep ? assertion.confidence : 0;
  if (keep && !supportedIndexes.length) {
    explicitness = "model_knowledge";
    confidence = Math.min(confidence, 0.45);
  } else if (keep) {
    const supports = supportedIndexes.map((index) => verified.evidence[index]);
    const user = supports.filter((proof) => proof.evidenceOrigin === "user_input");
    const isDirect = (proof: (typeof supports)[number]) =>
      proof.verificationStatus === "verified_quote" && proof.inferenceType !== "inferred";
    const direct = evidenceSet
      ? supports.every(isDirect) && (user.length === 0 || user.length === supports.length)
      : (user.length ? user : supports).some(isDirect);
    const alreadyInferred = ["inferred", "source_interpreted", "model_knowledge"].includes(assertion.explicitness);
    explicitness = character
      ? direct && !alreadyInferred
        ? user.length
          ? "user_explicit"
          : "source_explicit"
        : "source_interpreted"
      : direct && !alreadyInferred
        ? assertion.explicitness === "user_confirmed"
          ? "user_confirmed"
          : "user_explicit"
        : "inferred";
    if (character && assertion.explicitness === "model_knowledge") {
      explicitness = "model_knowledge";
      confidence = Math.min(confidence, 0.45);
    }
  }
  const accepted = new Set([...supportedIndexes, ...modelIndexes]);
  const reasonCode = keep
    ? "accepted"
    : assertion.scopeAssessment.verdict !== "consistent"
      ? "scope_unresolved"
      : !scopeConsistent
        ? "anchor_unavailable"
        : verified.evidence.some((proof) => proof.verificationStatus === "invalid")
          ? "evidence_unavailable"
          : "support_insufficient";
  const reason =
    reasonCode === "anchor_unavailable"
      ? "対象の照合に必要な原文を確認できません。"
      : reasonCode === "evidence_unavailable"
        ? "根拠の出典本文または引用を確認できません。"
        : !scopeConsistent
          ? `対象・否定範囲を確認できません：${assertion.scopeAssessment.reason}`
          : !keep
            ? "主張全体を支持する有効な根拠を確認できません。"
            : explicitness !== assertion.explicitness
              ? `検証後の根拠に合わせて出所を${explicitness}へ変更しました。`
              : null;
  return {
    keep,
    explicitness,
    confidence,
    evidence: verified.evidence.flatMap((proof, index) => {
      if (!accepted.has(index) && proof.verificationStatus !== "invalid") return [];
      return [{ ...proof, inferenceType: modelIndexes.includes(index) ? ("inferred" as const) : proof.inferenceType }];
    }),
    audit: {
      policyVersion: SEMANTIC_AUDIT_POLICY,
      targetId: target.targetId,
      scope: assertion.scopeAssessment,
      evidenceSetAssessment: evidenceSet ?? null,
      anchors,
      evidence: assertion.evidence.map((ref, index) => ({
        reference: ref,
        verification: verified.evidence[index],
        accepted: keep && accepted.has(index),
      })),
      keep,
      reason,
      reasonCode,
      before: { confidence: assertion.confidence, explicitness: assertion.explicitness },
      after: {
        confidence,
        explicitness,
        normalizedModelEvidenceIndexes: modelIndexes.filter(
          (index) => assertion.evidence[index].inferenceType !== "inferred",
        ),
      },
    },
  };
}
