import type { AnyGeneratedCharacterCandidate, GenerationValidationReport } from "../../../shared/contracts/generation";
import type { GenerationBrief } from "../../../shared/contracts/generation-brief";
import { createJudgmentProvider } from "../../judgment/provider";
import type { ChoiceAnswer, JudgmentProvider, JudgmentRequest, JudgmentResult } from "../../judgment/types";
import {
  JEV_DARK_GENERATION_POLICIES,
  JEV_GENERATION_POLICIES,
  pointerQuestion,
  policyQuestion,
  selectionQuestion,
} from "../../llm/prompts/jev-generation";
import type { Env } from "../../types";
import { fakeValidationReport } from "./deterministic";
import { GENERATION_POLICY_CHECKS, isCharacterContentPointer, reconcileGenerationValidation } from "./validation";

const PASS_PROBABILITY = 0.95;
const PASS_CONFIDENCE = 0.9;

type PolicyId = (typeof GENERATION_POLICY_CHECKS)[number];
type CheckGroup = { id: string; keys: string[]; pointers: string[] };
export type JevValidationDecision = {
  report: GenerationValidationReport | null;
  reason: "pass" | "not_satisfied" | "low_confidence" | "pointer_unavailable" | "reconcile_rejected";
  model: string;
  usage: JudgmentResult["usage"];
};

function policyPointers(domain: GenerationBrief["analysisDomain"], id: PolicyId): string[] {
  switch (id) {
    case "policy:unrequested_moralization":
      return domain === "dark" ? ["/valuesAndMorality", "/darkMorality"] : ["/valuesAndMorality"];
    case "policy:fictional_distance":
      return domain === "dark" ? ["/narrativeRole", "/darkCore/agency"] : ["/narrativeRole"];
    case "policy:creative_constraints":
      return domain === "dark"
        ? ["/identity/oneLineConcept", "/darkCore/narrativeFunction", "/darkArc"]
        : ["/identity/oneLineConcept", "/narrativeRole"];
  }
}

function fakeChoice(status: "satisfied" | "violated" | "uncertain"): ChoiceAnswer {
  return {
    type: "choice",
    choice: status,
    confidence: 1,
    probabilities: {
      satisfied: status === "satisfied" ? 1 : 0,
      violated: status === "violated" ? 1 : 0,
      uncertain: status === "uncertain" ? 1 : 0,
    },
  };
}

export async function tryJevGenerationValidation(
  env: Env,
  generationRequestId: string,
  brief: GenerationBrief,
  candidate: AnyGeneratedCharacterCandidate,
  stage: "initial" | "repaired",
  ordinal: number,
  provider: JudgmentProvider = createJudgmentProvider(env),
): Promise<JevValidationDecision> {
  const questions: JudgmentRequest["questions"] = {};
  const groups: CheckGroup[] = [];
  const fixture = fakeValidationReport(brief, candidate);
  const fakeAnswers: NonNullable<JudgmentRequest["fakeAnswers"]> = {};
  for (const [index, selection] of brief.preferenceSelections.entries()) {
    const key = `selection_${index}`;
    questions[key] = selectionQuestion(index);
    const status =
      fixture.checks.find((check) => check.constraintId === selection.profileSnapshotItemId)?.status ?? "uncertain";
    fakeAnswers[key] = fakeChoice(status);
    const pointerKey = `${key}_pointer`;
    questions[pointerKey] = pointerQuestion(`selections[${index}]`);
    fakeAnswers[pointerKey] = fakeChoice(status);
    const coverage = candidate.briefCoverage.find(
      (item) => item.profileSnapshotItemId === selection.profileSnapshotItemId,
    );
    groups.push({
      id: selection.profileSnapshotItemId,
      keys: [key, pointerKey],
      pointers: coverage?.outputPointers ?? [],
    });
  }
  for (const id of GENERATION_POLICY_CHECKS) {
    const instructions: readonly string[] = JEV_GENERATION_POLICIES[id];
    const policyAspects =
      id === "policy:creative_constraints" && brief.analysisDomain === "dark"
        ? [...instructions, ...JEV_DARK_GENERATION_POLICIES]
        : instructions;
    const keys = policyAspects.map((instruction, index) => {
      const key = `${id}_${index}`;
      questions[key] = policyQuestion(instruction);
      fakeAnswers[key] = fakeChoice(fixture.checks.find((check) => check.constraintId === id)?.status ?? "uncertain");
      return key;
    });
    const pointerKey = `${id}_pointer`;
    questions[pointerKey] = pointerQuestion(id);
    fakeAnswers[pointerKey] = fakeChoice(
      fixture.checks.find((check) => check.constraintId === id)?.status ?? "uncertain",
    );
    keys.push(pointerKey);
    groups.push({ id, keys, pointers: policyPointers(brief.analysisDomain, id) });
  }

  const { briefCoverage: _coverage, ...character } = candidate;
  const result = await provider.evaluate({
    state: {
      character,
      selections: brief.preferenceSelections,
      coveragePointers: groups.slice(0, brief.preferenceSelections.length).map((group) => group.pointers),
      policyPointers: Object.fromEntries(
        groups.slice(brief.preferenceSelections.length).map((group) => [group.id, group.pointers]),
      ),
      brief: {
        analysisDomain: brief.analysisDomain,
        purpose: brief.purpose,
        creativeContext: brief.creativeContext,
        constraints: brief.constraints,
        valuePolicy: brief.valuePolicy,
      },
    },
    questions,
    fakeAnswers,
    context: {
      correlationId: generationRequestId,
      stage: `generation-validation-${stage}-${ordinal}`,
      domain: brief.analysisDomain,
    },
  });
  const base = { model: result.model, usage: result.usage };
  if (
    groups.some(
      (group) =>
        !group.pointers.length || group.pointers.some((pointer) => !isCharacterContentPointer(candidate, pointer)),
    )
  )
    return { ...base, report: null, reason: "pointer_unavailable" };
  for (const group of groups) {
    for (const key of group.keys) {
      const answer = result.answers[key];
      if (answer.choice !== "satisfied") return { ...base, report: null, reason: "not_satisfied" };
      if (answer.confidence < PASS_CONFIDENCE || (answer.probabilities.satisfied ?? 0) < PASS_PROBABILITY)
        return { ...base, report: null, reason: "low_confidence" };
    }
  }
  const report = reconcileGenerationValidation(brief, candidate, {
    passed: true,
    checks: groups.map((group) => ({
      constraintId: group.id,
      status: "satisfied" as const,
      outputPointers: group.pointers,
      explanation: "人物の実設定を対象に自動判定で条件を満たすと評価しました。",
    })),
    violations: [],
  });
  return report.passed ? { ...base, report, reason: "pass" } : { ...base, report: null, reason: "reconcile_rejected" };
}
