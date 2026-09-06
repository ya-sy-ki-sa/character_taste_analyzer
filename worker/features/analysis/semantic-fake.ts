import type { EvidenceReference } from "../../../shared/contracts/evidence";
import type { PreferenceCandidate } from "../../../shared/contracts/preference";
import type {
  AuditedEvidence,
  GroundedPreferenceAudit,
  GroundedUnderstandingAudit,
  ScopedProposition,
} from "../../../shared/contracts/semantic-audit";
import type { UnderstandingAudit } from "../../../shared/contracts/understanding-quality";

/** Scripted offline responses only. Never used to infer a live audit result. */
export function fakeSemanticFields(assertion: {
  evidence: EvidenceReference[];
  rawLabel?: string;
  targetRef?: string;
  valueText?: string;
}): { scopeAssessment: ScopedProposition; evidence: AuditedEvidence[] } {
  return {
    scopeAssessment: {
      verdict: "consistent",
      reason: "Offline fixtureで定義した命題対応。",
      actor: null,
      target: null,
      possessor: null,
      evaluatedProposition: assertion.valueText ?? assertion.rawLabel ?? assertion.targetRef ?? "固定した命題",
      negatedProposition: null,
      anchors: assertion.evidence.filter((ref) => ref.sourceRef !== "model_knowledge"),
    } satisfies ScopedProposition,
    evidence: assertion.evidence.map((ref) => ({
      ...ref,
      supportAssessment: {
        verdict: ref.sourceRef === "model_knowledge" ? ("unverifiable" as const) : ("supported" as const),
        reason: "Offline fixtureの固定判定。実モデルの精度評価ではありません。",
      },
    })),
  };
}
export function fakeGroundedUnderstanding(candidate: UnderstandingAudit): GroundedUnderstandingAudit {
  return { ...candidate, assertions: candidate.assertions.map((item) => ({ ...item, ...fakeSemanticFields(item) })) };
}
export function fakeGroundedPreferences(candidate: PreferenceCandidate): GroundedPreferenceAudit {
  return {
    ...candidate,
    preferenceAssertions: candidate.preferenceAssertions.map((item) => ({ ...item, ...fakeSemanticFields(item) })),
    valueStanceAssertions: candidate.valueStanceAssertions.map((item) => ({ ...item, ...fakeSemanticFields(item) })),
  };
}
