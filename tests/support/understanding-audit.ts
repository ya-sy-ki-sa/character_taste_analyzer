import type { UnderstandingCandidate } from "../../shared/contracts/understanding";
import { type UnderstandingAudit, understandingAuditSchema } from "../../shared/contracts/understanding-quality";
import { understandingAspects } from "../../shared/understanding-aspects";
import { fakeUnderstandingAudit } from "../../worker/features/analysis/deterministic";
import type fixtures from "../fixtures/sparse-understanding.json";

/** Hand-authored audit expectations, not a semantic evaluator. */
export function concreteAudit(candidate: UnderstandingCandidate): UnderstandingAudit {
  const audit = fakeUnderstandingAudit(candidate);
  for (const aspect of understandingAspects) {
    if (!audit.aspectAssessments[aspect].summaryIndexes.length) continue;
    audit.aspectAssessments[aspect] = {
      ...audit.aspectAssessments[aspect],
      kind: "concrete",
      reason: "テストで定義した具体的な人物描写。",
      assertionIndexes: [0],
    };
  }
  return understandingAuditSchema.parse(audit);
}

export function frozenAudit(fixture: (typeof fixtures)[number]): UnderstandingAudit {
  return understandingAuditSchema.parse({
    sourceAssessment: { coverage: "minimal", limitations: [], modelKnowledgeUsed: fixture.caseId === "D03" },
    summary: fixture.summary,
    assertions: fixture.assertions.map((item) => ({
      ...item,
      attributeStableKey: null,
      assertionKind: "setting",
      scopeText: "凍結した対象範囲",
      confidence: 0.4,
      evidence: [
        { sourceRef: "model_knowledge", sourceUrl: null, inputPointer: null, quote: null, inferenceType: "inferred" },
      ],
    })),
    customizationDeltas: [],
    uncertainties: understandingAspects
      .filter((aspect) => !fixture.summary[aspect].length)
      .map((topic) => ({ topic, reason: fixture.aspectAssessments[topic].reason })),
    aspectAssessments: fixture.aspectAssessments,
  });
}
