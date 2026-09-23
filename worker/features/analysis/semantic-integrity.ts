import type { CitationIssue } from "../../../shared/contracts/citations";
import type {
  AuditedEvidence,
  EvidenceSetAssessment,
  ScopedProposition,
} from "../../../shared/contracts/semantic-audit";
import { DEGRADED_EXPLICIT_CONFIDENCE_CAP, type JudgmentDisposition } from "../../judgment/policy";
import { ANALYSIS_JUDGMENT_POLICY_VERSION } from "../../llm/prompts/judgment-analysis";
import type { CitationRegistry } from "../../platform/provenance/registry";
import { type ProvenanceSource, verifyEvidenceReference } from "../../platform/provenance/verifier";
import { verifyAssertionEvidence } from "./citations";

type Assertion = {
  evidence: AuditedEvidence[];
  scopeAssessment: ScopedProposition;
  evidenceSetAssessment?: EvidenceSetAssessment | null;
  confidence: number;
  explicitness: string;
  responseChannel?: string | null;
  judgmentDisposition?: JudgmentDisposition;
};
const explicitnessLabel = (value: string) =>
  ({
    user_confirmed: "ユーザー確認済み",
    user_explicit: "ユーザー原文で明示",
    source_explicit: "資料で明示",
    source_interpreted: "資料からの解釈",
    inferred: "原文からの推測",
    model_knowledge: "モデル知識",
  })[value] ?? "確認できる出所";

export async function verifySemanticAssertion(
  assertion: Assertion,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
  registry: CitationRegistry,
  target: Pick<CitationIssue, "targetType" | "targetId" | "modelRunId">,
  issues: CitationIssue[],
  questionPrefix?: string,
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
  const degradedVerifiedIndexes = verified.evidence.flatMap((proof, index) => {
    const reference = assertion.evidence[index];
    const support = reference.supportAssessment;
    const originMatches = ["source_explicit", "source_interpreted"].includes(assertion.explicitness)
      ? proof.evidenceOrigin === "source"
      : ["user_explicit", "inferred"].includes(assertion.explicitness)
        ? proof.evidenceOrigin === "user_input"
        : false;
    const lowConfidence =
      support.decisionCertain === false ||
      (support.decisionCertain === undefined && assertion.judgmentDisposition === "degraded");
    return assertion.judgmentDisposition === "degraded" &&
      lowConfidence &&
      ["partial", "unverifiable"].includes(support.verdict) &&
      proof.verificationStatus === "verified_quote" &&
      originMatches
      ? [index]
      : [];
  });
  const evidenceSet = assertion.evidenceSetAssessment;
  const setIndexes = evidenceSet?.evidenceIndexes ?? [];
  const uniqueSetIndexes = [...new Set(setIndexes)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < verified.evidence.length,
  );
  const invalidSetIndex = Boolean(
    evidenceSet?.verdict === "supported" &&
      (setIndexes.length === 0 ||
        setIndexes.length > 3 ||
        uniqueSetIndexes.length !== setIndexes.length ||
        uniqueSetIndexes.length !==
          setIndexes.filter((index) => index >= 0 && index < verified.evidence.length).length),
  );
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
  // Jev may return duplicated or out-of-range set indexes. Treat that as an
  // auditable structural defect and salvage independently verified evidence.
  const supportedIndexes = evidenceSet
    ? validSet
      ? setIndexes
      : individuallySupportedIndexes
    : individuallySupportedIndexes;
  // Only a deliberately separate model-knowledge reference can survive as model knowledge.
  const modelIndexes = character
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
  const directUserIndexes = verified.evidence.flatMap((proof, index) => {
    const reference = assertion.evidence[index];
    return proof.verificationStatus === "verified_quote" &&
      proof.evidenceOrigin === "user_input" &&
      reference.inferenceType === "direct"
      ? [index]
      : [];
  });
  const explicitPreferenceFallback =
    target.targetType === "preference_assertion" &&
    assertion.judgmentDisposition === "degraded" &&
    assertion.explicitness === "user_explicit" &&
    directUserIndexes.length > 0;
  const inferredWishfulFallback =
    target.targetType === "preference_assertion" &&
    assertion.responseChannel === "wishful_identification" &&
    assertion.explicitness === "inferred" &&
    assertion.judgmentDisposition === "degraded" &&
    assertion.scopeAssessment.verdict === "uncertain" &&
    /^(?:ユーザー|自分|私|僕|俺|わたし)$/u.test(assertion.scopeAssessment.actor ?? "") &&
    Boolean(assertion.scopeAssessment.target) &&
    anchored &&
    individuallySupportedIndexes.some((index) =>
      /(?:自分も|私も|僕も|俺も).{0,60}(?:なりたい|したい|できるようになりたい)/u.test(
        assertion.evidence[index].quote ?? "",
      ),
    );
  const degradedCharacterFallback =
    character &&
    assertion.judgmentDisposition === "degraded" &&
    assertion.scopeAssessment.verdict !== "mismatch" &&
    (supportedIndexes.length > 0 || degradedVerifiedIndexes.length > 0 || modelIndexes.length > 0);
  const verifiedSubsetFallback = Boolean(evidenceSet && !validSet && supportedIndexes.length > 0);
  const rejectedByJudgment = assertion.judgmentDisposition === "rejected";
  const keep = Boolean(
    !rejectedByJudgment &&
      ((scopeConsistent && (supportedIndexes.length || modelIndexes.length)) ||
        explicitPreferenceFallback ||
        inferredWishfulFallback ||
        degradedCharacterFallback),
  );
  const acceptedSupportedIndexes = [
    ...new Set([
      ...supportedIndexes,
      ...degradedVerifiedIndexes,
      ...(explicitPreferenceFallback ? directUserIndexes : []),
    ]),
  ];
  let explicitness = assertion.explicitness;
  let confidence = keep
    ? explicitPreferenceFallback || inferredWishfulFallback || degradedCharacterFallback || verifiedSubsetFallback
      ? Math.min(assertion.confidence, DEGRADED_EXPLICIT_CONFIDENCE_CAP)
      : assertion.confidence
    : 0;
  if (keep && explicitPreferenceFallback) {
    explicitness = "user_explicit";
  } else if (keep && !acceptedSupportedIndexes.length) {
    explicitness = "model_knowledge";
    confidence = Math.min(confidence, 0.45);
  } else if (keep) {
    const supports = acceptedSupportedIndexes.map((index) => verified.evidence[index]);
    const user = supports.filter((proof) => proof.evidenceOrigin === "user_input");
    const source = supports.filter((proof) => proof.evidenceOrigin === "source");
    const allSourceSupportIsOfficial =
      source.length > 0 && source.every((proof) => ["official", "primary"].includes(proof.sourceType ?? ""));
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
          : allSourceSupportIsOfficial
            ? "source_explicit"
            : "source_interpreted"
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
  const accepted = new Set([...acceptedSupportedIndexes, ...modelIndexes]);
  const reasonCode = keep
    ? explicitPreferenceFallback
      ? "accepted_explicit_fallback"
      : inferredWishfulFallback
        ? "accepted_wishful_scope_fallback"
        : degradedCharacterFallback || verifiedSubsetFallback
          ? "accepted_verified_subset"
          : "accepted"
    : rejectedByJudgment
      ? "judgment_rejected"
      : assertion.scopeAssessment.verdict !== "consistent"
        ? "scope_unresolved"
        : !scopeConsistent
          ? "anchor_unavailable"
          : verified.evidence.some((proof) => proof.verificationStatus === "invalid")
            ? "evidence_unavailable"
            : "support_insufficient";
  const reason =
    reasonCode === "accepted_explicit_fallback"
      ? "Jevの判定が低確信だったため、照合済みのユーザー明示引用を低confidenceで保持しました。"
      : reasonCode === "accepted_wishful_scope_fallback"
        ? "主体がユーザーの願望であるため対象判定は未確定ですが、人物への反応を示す照合済み引用を推測のまま低confidenceで保持しました。"
        : reasonCode === "accepted_verified_subset"
          ? "Jevの判定が低確信、または根拠集合に不備があったため、個別に照合できた根拠だけを低confidenceで保持しました。"
          : reasonCode === "judgment_rejected"
            ? "Jevが高確信で候補の矛盾または非支持を判定しました。"
            : reasonCode === "anchor_unavailable"
              ? "対象の照合に必要な原文を確認できません。"
              : reasonCode === "evidence_unavailable"
                ? "根拠の出典本文または引用を確認できません。"
                : !scopeConsistent
                  ? `対象・否定範囲を確認できません：${assertion.scopeAssessment.reason}`
                  : !keep
                    ? "主張全体を支持する有効な根拠を確認できません。"
                    : explicitness !== assertion.explicitness
                      ? `検証後の根拠に合わせて出所を「${explicitnessLabel(explicitness)}」へ変更しました。`
                      : null;
  return {
    keep,
    explicitness,
    confidence,
    evidence: verified.evidence.flatMap((proof, index) => {
      if (keep && !accepted.has(index)) return [];
      if (!keep && proof.verificationStatus !== "invalid") return [];
      return [{ ...proof, inferenceType: modelIndexes.includes(index) ? ("inferred" as const) : proof.inferenceType }];
    }),
    audit: {
      policyVersion: ANALYSIS_JUDGMENT_POLICY_VERSION,
      targetId: target.targetId,
      questionPrefix: questionPrefix ?? null,
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
      diagnosticCodes: [
        ...(invalidSetIndex ? ["invalid_set_index"] : []),
        ...(inferredWishfulFallback ? ["wishful_scope_fallback"] : []),
        ...(degradedVerifiedIndexes.length ? ["low_confidence_support"] : []),
        ...(rejectedByJudgment ? ["high_conflict", "high_semantic_rejection"] : []),
      ],
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
