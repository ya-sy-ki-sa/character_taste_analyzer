import {
  type AnyGeneratedCharacterCandidate,
  type GenerationValidationReport,
  generationValidationReportSchema,
} from "../../../shared/contracts/generation";
import type { GenerationBrief } from "../../../shared/contracts/generation-brief";
import { choiceAnswer, isCertainChoice, isCertainScore, scoreAnswer } from "../../judgment/policy";
import { createJudgmentProvider } from "../../judgment/provider";
import type { JudgmentAnswer, JudgmentQuestion } from "../../judgment/types";
import {
  generationCheckQuestion,
  generationRankingQuestion,
  policyInstructions,
  rankingCriteria,
} from "../../llm/prompts/judgment-generation";
import type { Env, GenerationWorkflowParams } from "../../types";
import { fakeValidationReport } from "./deterministic";
import type { CandidateResult } from "./types";
import { GENERATION_POLICY_CHECKS, isCharacterContentPointer, reconcileGenerationValidation } from "./validation";

function contentOf(candidate: AnyGeneratedCharacterCandidate) {
  const {
    briefCoverage: _coverage,
    uncertainties: _uncertainties,
    briefId: _briefId,
    schemaVersion: _version,
    ...content
  } = candidate;
  return content;
}

export async function judgeGeneration(
  env: Env,
  generationRequestId: string,
  brief: GenerationBrief,
  candidate: AnyGeneratedCharacterCandidate,
  ordinal: number,
): Promise<GenerationValidationReport> {
  const provider = createJudgmentProvider(env);
  const questions: Record<string, JudgmentQuestion> = {};
  const fakeAnswers: Record<string, JudgmentAnswer> = {};
  const fixture = fakeValidationReport(brief, candidate);
  const ids = [...brief.preferenceSelections.map((item) => item.profileSnapshotItemId), ...GENERATION_POLICY_CHECKS];
  const groups = new Map<string, string[]>();
  for (const [index, id] of ids.entries()) {
    const policy = GENERATION_POLICY_CHECKS.find((key) => key === id);
    const keys: string[] = [];
    for (let aspect = 0; aspect < (policy ? policyInstructions[policy].length : 1); aspect++) {
      const question = generationCheckQuestion(index, policy, aspect);
      const key = aspect === 0 ? `check_${index}` : `check_${index}_${aspect}`;
      questions[key] = question;
      fakeAnswers[key] = choiceAnswer(
        question,
        fixture.checks.find((check) => check.constraintId === id)?.status ?? "uncertain",
      );
      keys.push(key);
    }
    groups.set(id, keys);
  }
  const judged = await provider.evaluate({
    state: {
      character: contentOf(candidate),
      selections: brief.preferenceSelections,
      brief: {
        purpose: brief.purpose,
        creativeContext: brief.creativeContext,
        constraints: brief.constraints,
        valuePolicy: brief.valuePolicy,
        domain: brief.analysisDomain,
      },
    },
    questions,
    fakeAnswers,
    context: {
      correlationId: generationRequestId,
      stage: `generation-validation-${ordinal}`,
      domain: brief.analysisDomain,
    },
  });
  const checks: GenerationValidationReport["checks"] = ids.map((id) => {
    const answers = (groups.get(id) ?? []).map((key) => judged.answers[key]);
    const status = answers.some((answer) => isCertainChoice(answer) && answer.choice === "violated")
      ? "violated"
      : answers.length > 0 && answers.every((answer) => isCertainChoice(answer) && answer.choice === "satisfied")
        ? "satisfied"
        : "uncertain";
    const coverage = candidate.briefCoverage.find((item) => item.profileSnapshotItemId === id);
    const pointers = coverage?.outputPointers.filter((pointer) => isCharacterContentPointer(candidate, pointer)) ?? [];
    return {
      constraintId: id,
      status,
      outputPointers: pointers.length
        ? pointers
        : Object.keys(contentOf(candidate))
            .slice(0, 20)
            .map((key) => `/${key}`),
      explanation:
        status === "satisfied"
          ? "対象・条件を保持した設定として支持されています。"
          : status === "violated"
            ? "指定条件と設定の意味が一致しません。該当条件を再検討してください。"
            : "指定条件を満たすか確定できません。設定と条件の対応を確認してください。",
    };
  });
  // Coverage is a stored explanation of the checked character, not an independent LLM verdict.
  // Keep the supplied pointers so the deterministic validator still rejects invalid references.
  candidate.briefCoverage = candidate.briefCoverage.map((coverage) => {
    const check = checks.find((item) => item.constraintId === coverage.profileSnapshotItemId);
    return check
      ? {
          ...coverage,
          status: check.status === "uncertain" ? "partially_satisfied" : check.status,
          explanation: check.explanation,
        }
      : coverage;
  });
  return reconcileGenerationValidation(
    brief,
    candidate,
    generationValidationReportSchema.parse({ passed: true, checks, violations: [] }),
  );
}

export async function rankGenerationCandidates(
  env: Env,
  params: GenerationWorkflowParams,
  brief: GenerationBrief,
  candidates: CandidateResult[],
) {
  const provider = createJudgmentProvider(env);
  const tasks: Array<{ indexes: number[]; run: ReturnType<typeof provider.evaluate> }> = [];
  const context = {
    correlationId: params.generationRequestId,
    stage: "generation-ranking",
    domain: params.analysisDomain,
  };
  for (const [index, item] of candidates.entries()) {
    const preferenceFit = generationRankingQuestion(0, "preferenceFit");
    const coherence = generationRankingQuestion(0, "coherence");
    tasks.push({
      indexes: [index],
      run: provider.evaluate({
        state: { selections: brief.preferenceSelections, candidates: [{ character: contentOf(item.candidate) }] },
        questions: { preferenceFit, coherence },
        fakeAnswers: { preferenceFit: scoreAnswer(preferenceFit, 3), coherence: scoreAnswer(coherence, 3) },
        context,
      }),
    });
  }
  // Compare pairs, rather than resending three full characters for every quality axis.
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const difference = generationRankingQuestion(0, "difference");
      tasks.push({
        indexes: [left, right],
        run: provider.evaluate({
          state: {
            candidates: [candidates[left], candidates[right]].map((item) => ({ character: contentOf(item.candidate) })),
          },
          questions: { difference },
          fakeAnswers: { difference: scoreAnswer(difference, 3) },
          context,
        }),
      });
    }
  }
  const results = await Promise.allSettled(tasks.map((task) => task.run));
  const assessments = candidates.map(() => ({
    preferenceFit: [] as JudgmentAnswer[],
    coherence: [] as JudgmentAnswer[],
    difference: [] as JudgmentAnswer[],
  }));
  for (const [taskIndex, outcome] of results.entries()) {
    if (outcome.status === "rejected") throw outcome.reason;
    for (const index of tasks[taskIndex].indexes) {
      for (const axis of ["preferenceFit", "coherence", "difference"] as const) {
        const answer = outcome.value.answers[axis];
        if (answer) assessments[index][axis].push(answer);
      }
    }
  }
  const ranks = new Map<string, number[]>();
  let certain = true;
  for (const [index, candidate] of candidates.entries()) {
    const scores: number[] = [];
    for (const axis of ["preferenceFit", "coherence", "difference"] as const) {
      if (axis === "difference" && candidates.length === 1) {
        scores.push(2);
        candidate.comparison.difference = "合格した比較対象はこの案のみです。";
        continue;
      }
      const answers = assessments[index][axis];
      const reliable = answers.length > 0 && answers.every(isCertainScore);
      certain &&= reliable;
      const score = reliable ? Math.min(...answers.map((answer) => (answer.type === "score" ? answer.score : 0))) : 0;
      scores.push(score);
      candidate.comparison[axis] = reliable
        ? `${rankingCriteria[axis][Math.round(score)]}。`
        : "比較評価が未確定です。具体的な設定を比較して選択してください。";
    }
    candidate.comparison.tradeoffs = [
      "必須・禁止条件の検査に合格した候補です。最終的な好みは比較して確認してください。",
    ];
    ranks.set(candidate.id, scores);
  }
  // Uncertain rankings do not make otherwise valid characters fail or imply a confident winner.
  candidates.sort((a, b) => {
    if (certain) {
      const left = ranks.get(a.id) ?? [];
      const right = ranks.get(b.id) ?? [];
      for (let axis = 0; axis < 3; axis++) if (left[axis] !== right[axis]) return right[axis] - left[axis];
    }
    return a.ordinal - b.ordinal;
  });
}
