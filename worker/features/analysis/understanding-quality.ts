import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import type {
  UnderstandingAudit,
  UnderstandingInformationQuality,
} from "../../../shared/contracts/understanding-quality";
import {
  type UnderstandingAspect as Aspect,
  understandingAspects as aspects,
  understandingAspectLabels,
} from "../../../shared/understanding-aspects";

import { UNDERSTANDING_INFORMATION_POLICY } from "../../llm/prompts/understanding";

export { understandingAspectLabels } from "../../../shared/understanding-aspects";

export {
  UNDERSTANDING_COMPLETENESS_INSTRUCTION,
  UNDERSTANDING_INFORMATION_INSTRUCTION,
  UNDERSTANDING_INFORMATION_POLICY,
} from "../../llm/prompts/understanding";

export function assessUnderstandingInformation(
  candidate: UnderstandingAudit,
  completionAttempted: boolean,
): UnderstandingInformationQuality {
  const contentAspectCount = aspects.filter((aspect) => hasContent(candidate.summary[aspect])).length;
  const concreteAspectCount = aspects.filter(
    (aspect) => candidate.aspectAssessments[aspect].kind === "concrete",
  ).length;
  const limited = contentAspectCount <= 1 || concreteAspectCount < 2;
  return {
    policyVersion: UNDERSTANDING_INFORMATION_POLICY,
    assessedAt: "analysis",
    status: limited ? "limited" : "not_flagged",
    contentAspectCount,
    concreteAspectCount,
    completionAttempted,
    reasons: limited
      ? [
          ...(contentAspectCount <= 1 ? ["人物像の7項目のうち、内容のある項目が1つ以下です。"] : []),
          ...(concreteAspectCount < 2
            ? ["具体的な人物描写を得られた項目が2つ未満です。役割名や出所の注記だけでは人物像を十分に説明できません。"]
            : []),
        ]
      : [],
    aspects: candidate.aspectAssessments,
  };
}

const hasContent = (values: string[]) => values.some((value) => value.trim().length > 0);

function uncertaintyFor(candidate: UnderstandingCandidate, aspect: Aspect) {
  return candidate.uncertainties.find(
    (item) =>
      (item.topic === aspect || item.topic === understandingAspectLabels[aspect]) && item.reason.trim().length > 0,
  );
}

export function understandingQualityIssues(candidate: UnderstandingCandidate): string[] {
  const issues = aspects
    .filter((aspect) => !hasContent(candidate.summary[aspect]) && !uncertaintyFor(candidate, aspect))
    .map((aspect) => `${aspect}: 内容、またはこのキーをtopicとする不明理由が必要です`);
  if (aspects.every((aspect) => !hasContent(candidate.summary[aspect])))
    issues.unshift("人物の同定だけで、7項目のキャラクター像がすべて空です");
  return issues;
}

/** Unknowns are display text only; never turn them into character assertions. */
export function explainUnknownUnderstandingAspects(candidate: UnderstandingCandidate): UnderstandingCandidate {
  const summary = { ...candidate.summary };
  for (const aspect of aspects) {
    const content = summary[aspect].map((item) => item.trim()).filter(Boolean);
    const uncertainty = uncertaintyFor(candidate, aspect);
    summary[aspect] = content.length
      ? content
      : uncertainty
        ? [
            `確認できません：${uncertainty.reason.trim()}`.slice(
              0,
              aspect === "narrativeRole" || aspect === "moralityOrientation" ? 200 : 500,
            ),
          ]
        : [];
  }
  return { ...candidate, summary };
}
