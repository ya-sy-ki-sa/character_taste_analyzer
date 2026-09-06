import type { GroundedUnderstandingAudit } from "../../../shared/contracts/semantic-audit";
import { understandingAuditSchema } from "../../../shared/contracts/understanding-quality";
import { understandingAspects } from "../../../shared/understanding-aspects";
import type { verifySemanticAssertion } from "./semantic-integrity";
import { assessUnderstandingInformation, explainUnknownUnderstandingAspects } from "./understanding-quality";

type Verified = Awaited<ReturnType<typeof verifySemanticAssertion>>;
export function normalizeUnderstanding(
  audit: GroundedUnderstandingAudit,
  verified: Verified[],
  completionAttempted: boolean,
) {
  const next = structuredClone(audit);
  const indexes = new Map<number, number>();
  next.assertions = audit.assertions.flatMap((assertion, index) => {
    if (!verified[index].keep) return [];
    indexes.set(index, indexes.size);
    return [
      {
        ...assertion,
        confidence: verified[index].confidence,
        explicitness: verified[index].explicitness as typeof assertion.explicitness,
      },
    ];
  });
  for (const aspect of understandingAspects) {
    const assessment = next.aspectAssessments[aspect];
    const retained = assessment.assertionIndexes.filter((index) => indexes.has(index));
    const removed = retained.length !== assessment.assertionIndexes.length;
    if (removed || (!next.assertions.length && audit.assertions.length)) {
      const max = aspect === "narrativeRole" || aspect === "moralityOrientation" ? 200 : 500;
      next.summary[aspect] = retained.map((index) => audit.assertions[index].valueText.slice(0, max));
      assessment.summaryIndexes = next.summary[aspect].map((_, index) => index);
      assessment.kind = retained.length ? assessment.kind : "unknown";
      assessment.reason = retained.length
        ? "根拠検証後に保持された人物描写に参照を更新しました。"
        : "対象・根拠の検証後に採用できる人物描写が残りませんでした。";
      if (!retained.length) next.uncertainties.push({ topic: aspect, reason: assessment.reason });
    }
    assessment.assertionIndexes = retained.map((index) => indexes.get(index) as number);
  }
  next.uncertainties = next.uncertainties.slice(-50);
  const parsed = understandingAuditSchema.parse(next);
  return {
    ...explainUnknownUnderstandingAspects(parsed),
    informationQuality: assessUnderstandingInformation(parsed, completionAttempted),
  };
}
