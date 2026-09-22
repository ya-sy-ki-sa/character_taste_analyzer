import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type {
  DarkBaselineUnderstanding,
  DarkScopeAssessment,
  DarkTransformationDelta,
  DarkUnderstandingCandidate,
} from "../../../shared/contracts/dark-understanding";
import type { EvidenceReference } from "../../../shared/contracts/evidence";
import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import type { AnyPreferenceCandidate, PreferenceCandidate } from "../../../shared/contracts/preference";
import type { PreferenceHypothesis } from "../../../shared/contracts/refinement";
import type {
  AuditedEvidence,
  EvidenceSetAssessment,
  GroundedUnderstandingAudit,
  ScopedProposition,
} from "../../../shared/contracts/semantic-audit";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import type { AspectAssessments } from "../../../shared/contracts/understanding-quality";
import { entryInputSources } from "../../../shared/entry-input";
import { darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import { responseChannelCatalog } from "../../../shared/response-channels";
import {
  type UnderstandingAspect,
  understandingAspectLabels,
  understandingAspects,
} from "../../../shared/understanding-aspects";
import { createJudgmentProvider } from "../../judgment/provider";
import {
  choiceAnswer,
  isCertainChoice,
  isCertainNoul,
  isCertainScore,
  scoreAnswer,
} from "../../judgment/policy";
import type { JudgmentAnswer, JudgmentProvider, JudgmentQuestion } from "../../judgment/types";
import {
  ANALYSIS_INPUT_CLASSIFICATION_CRITERIA,
  ANALYSIS_JUDGMENT_PROMPTS,
  ANALYSIS_SCOPE_CRITERIA,
  ANALYSIS_SUPPORT_CRITERIA,
} from "../../llm/prompts/judgment-analysis";
import type { ProvenanceSource } from "../../platform/provenance/verifier";
import type { Env } from "../../types";
import type { CharacterResearch } from "./research";
import type { AttributeRow } from "./types";

const CONFIDENCE_CAPS = {
  user_confirmed: 0.95,
  user_explicit: 0.9,
  source_explicit: 0.9,
  source_interpreted: 0.7,
  inferred: 0.5,
  model_knowledge: 0.45,
} as const;

const STRENGTH_ANCHORS = [0.3, 0.6, 0.8, 0.95] as const;
const MAX_SOURCE_CHARS = 18_000;

type SemanticFields = {
  scopeAssessment: ScopedProposition;
  evidence: AuditedEvidence[];
  evidenceSetAssessment: EvidenceSetAssessment | null;
};

type AuditedPreferenceCandidate = Omit<AnyPreferenceCandidate, "preferenceAssertions" | "valueStanceAssertions"> & {
  preferenceAssertions: Array<AnyPreferenceCandidate["preferenceAssertions"][number] & SemanticFields>;
  valueStanceAssertions: Array<AnyPreferenceCandidate["valueStanceAssertions"][number] & SemanticFields>;
};

export type PreferenceJudgment = {
  candidate: AnyPreferenceCandidate;
  audited: AuditedPreferenceCandidate;
  issues: string[];
};

export function analysisIssueText(issue: string): string {
  const separator = issue.lastIndexOf(": ");
  return (separator >= 0 ? issue.slice(separator + 2) : issue).replace(/\bJev\b/giu, "意味判定").trim();
}

function choiceQuestion(instructions: string, criteria: Record<string, string>): JudgmentQuestion {
  return { type: "choice", instructions, criteria };
}

function noulQuestion(instructions: string): JudgmentQuestion {
  return {
    type: "noul",
    instructions,
    criteria: { true: "条件に該当する。", false: "条件に該当しない。" },
  };
}

function scoreQuestion(instructions: string, criteria: string[]): JudgmentQuestion {
  return { type: "score", instructions, criteria };
}

function fakeChoice(questions: Record<string, JudgmentQuestion>, id: string, value: string): JudgmentAnswer {
  const question = questions[id];
  if (question?.type !== "choice") throw new Error(`JUDGMENT_FIXTURE_QUESTION_MISSING:${id}`);
  return choiceAnswer(question, value);
}

function fakeScore(questions: Record<string, JudgmentQuestion>, id: string, value: number): JudgmentAnswer {
  const question = questions[id];
  if (question?.type !== "score") throw new Error(`JUDGMENT_FIXTURE_QUESTION_MISSING:${id}`);
  return scoreAnswer(question, value);
}

function answerChoice(answer: JudgmentAnswer | undefined, fallback: string): string {
  return isCertainChoice(answer) ? answer.choice : fallback;
}

function sourceInputs(payload: AnyEntryDraft, includePreference: boolean) {
  return entryInputSources(payload)
    .filter((item) => includePreference === item.pointer.startsWith("/preference/"))
    .map((item) => ({ pointer: item.pointer, label: item.label, text: item.text, start: 0, end: item.text.length }));
}

type JudgmentSource = {
  pointer?: string | null;
  url?: string | null;
  label: string;
  text: string;
  /** UTF-16 offsets into the original source string. */
  start?: number;
  end?: number;
};

function sourceChunks<T extends JudgmentSource>(sources: T[]) {
  const chunks: Array<T & { start: number; end: number }> = [];
  for (const source of sources) {
    const sourceStart = source.start ?? 0;
    if (source.text.length <= MAX_SOURCE_CHARS) {
      chunks.push({ ...source, start: sourceStart, end: sourceStart + source.text.length });
      continue;
    }
    const step = MAX_SOURCE_CHARS - 500;
    for (let offset = 0; offset < source.text.length; offset += step) {
      const text = source.text.slice(offset, offset + MAX_SOURCE_CHARS);
      chunks.push({
        ...source,
        pointer: source.pointer,
        label: `${source.label} (${Math.floor(offset / step) + 1})`,
        text,
        start: sourceStart + offset,
        end: sourceStart + offset + text.length,
      });
    }
  }
  return chunks;
}

function normalizedTerms(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/[\s、。・/／()[\]{}「」『』]/gu, "");
  const terms = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index++) terms.add(normalized.slice(index, index + 2));
  return terms;
}

function attributeCandidates(
  text: string,
  currentKey: string | null,
  ontology: AttributeRow[],
): AttributeRow[] {
  const sourceTerms = normalizedTerms(text);
  const scored = ontology.map((item) => {
    const terms = normalizedTerms(`${item.label}${item.stable_key}`);
    const overlap = [...terms].filter((term) => sourceTerms.has(term)).length;
    return { item, overlap, current: item.stable_key === currentKey ? 1 : 0 };
  });
  return scored
    .filter((item) => item.current || item.overlap > 0)
    .sort((left, right) => right.current - left.current || right.overlap - left.overlap || left.item.stable_key.localeCompare(right.item.stable_key))
    .slice(0, 16)
    .map((item) => item.item);
}

function relevantSourceText(
  evidence: EvidenceReference,
  sources: JudgmentSource[],
) {
  const matched = sources.filter(
    (source) =>
      (evidence.inputPointer && source.pointer === evidence.inputPointer) ||
      (evidence.sourceUrl && source.url === evidence.sourceUrl) ||
      (evidence.quote && source.text.includes(evidence.quote)),
  );
  return matched.map((source) => {
    const sourceStart = source.start ?? 0;
    if (!evidence.quote || source.text.length <= 4_000)
      return { ...source, start: sourceStart, end: source.end ?? sourceStart + source.text.length };
    const index = source.text.indexOf(evidence.quote);
    if (index < 0) return { ...source, text: "", start: sourceStart, end: sourceStart };
    const start = Math.max(0, index - 1_000);
    const end = Math.min(source.text.length, index + evidence.quote.length + 1_000);
    return { ...source, text: source.text.slice(start, end), start: sourceStart + start, end: sourceStart + end };
  });
}

function explicitnessConfidence(explicitness: string, original: number): number {
  const cap = CONFIDENCE_CAPS[explicitness as keyof typeof CONFIDENCE_CAPS] ?? 0.5;
  return Math.min(original, cap);
}

function closestStrengthIndex(value: number): number {
  return STRENGTH_ANCHORS.reduce(
    (best, anchor, index) =>
      Math.abs(anchor - value) < Math.abs(STRENGTH_ANCHORS[best] - value) ? index : best,
    0,
  );
}

function semanticFields(
  assertion: {
    evidence: EvidenceReference[];
    explicitness: string;
    confidence: number;
  },
  answers: Record<string, JudgmentAnswer>,
  prefix: string,
  proposition: { evaluated: string; actor?: string | null; target?: string | null; negated?: string | null },
  issues: string[],
): SemanticFields {
  const protectedByReview = assertion.explicitness === "user_confirmed";
  const scopeAnswer = answers[`${prefix}_scope`];
  const scope = protectedByReview ? "consistent" : answerChoice(scopeAnswer, "uncertain");
  if (!protectedByReview && (!isCertainChoice(scopeAnswer) || scope !== "consistent"))
    issues.push(`${prefix}: 主体・対象・否定・条件の対応を確定できません。`);

  const evidence = assertion.evidence.map((reference, index) => {
    const answer = answers[`${prefix}_evidence_${index}`];
    const modelKnowledge = reference.sourceRef === "model_knowledge";
    const verdict = protectedByReview
      ? "supported"
      : answerChoice(answer, modelKnowledge ? "unverifiable" : "unsupported");
    if (!protectedByReview && (!isCertainChoice(answer) || ["unsupported", "contradicted"].includes(verdict)))
      issues.push(`${prefix}: 根拠${index + 1}が候補を十分に支持しません。`);
    return {
      ...reference,
      supportAssessment: {
        verdict: verdict as AuditedEvidence["supportAssessment"]["verdict"],
        reason: `個別根拠の照合結果: ${verdict}`,
      },
    };
  });
  let evidenceSetAssessment: EvidenceSetAssessment | null = null;
  if (evidence.length > 1) {
    const answer = answers[`${prefix}_set`];
    const verdict = protectedByReview ? "supported" : answerChoice(answer, "unverifiable");
    if (!protectedByReview && (!isCertainChoice(answer) || verdict !== "supported"))
      issues.push(`${prefix}: 複数根拠を合わせた支持を確定できません。`);
    evidenceSetAssessment = {
      verdict: verdict as EvidenceSetAssessment["verdict"],
      evidenceIndexes: verdict === "supported" ? evidence.map((_, index) => index) : [],
      reason: `集合根拠の照合結果: ${verdict}`,
    };
  }
  const acceptedEvidence = evidence.filter((item) => ["supported", "partial"].includes(item.supportAssessment.verdict));
  return {
    scopeAssessment: {
      verdict: scope as ScopedProposition["verdict"],
      reason: protectedByReview ? "ユーザー確認済みの命題を保持しました。" : `命題範囲の照合結果: ${scope}`,
      actor: proposition.actor ?? null,
      target: proposition.target ?? null,
      possessor: null,
      evaluatedProposition: proposition.evaluated.slice(0, 1_000),
      negatedProposition: proposition.negated?.slice(0, 1_000) ?? null,
      anchors: acceptedEvidence.slice(0, 3).map(({ supportAssessment: _assessment, ...reference }) => reference),
    },
    evidence,
    evidenceSetAssessment,
  };
}

async function judgeAssertion(
  provider: JudgmentProvider,
  input: {
    correlationId: string;
    stage: string;
    domain: AnalysisDomain;
    prefix: string;
    assertion: { evidence: EvidenceReference[]; explicitness: string; confidence: number };
    proposition: unknown;
    sourceContext: unknown;
    attributes?: AttributeRow[];
    includePreferenceQuestions?: {
      classification: "preference" | "value_attitude";
      responseChannel?: string | null;
      strength?: number;
      polarity?: string;
    };
  },
) {
  const { prefix, assertion } = input;
  const questions: Record<string, JudgmentQuestion> = {
    [`${prefix}_scope`]: choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.scope,
      ANALYSIS_SCOPE_CRITERIA,
    ),
  };
  for (const [index] of assertion.evidence.entries())
    questions[`${prefix}_evidence_${index}`] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.evidence(index),
      ANALYSIS_SUPPORT_CRITERIA,
    );
  if (assertion.evidence.length > 1)
    questions[`${prefix}_set`] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.evidenceSet,
      ANALYSIS_SUPPORT_CRITERIA,
    );
  if (input.attributes?.length)
    questions[`${prefix}_attribute`] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.attribute,
      {
        ...Object.fromEntries(input.attributes.map((item) => [item.stable_key, `${item.label} (${item.category})`])),
        no_match: "辞書候補のどれにも意味・粒度・評価範囲が一致しない。",
      },
    );
  if (input.includePreferenceQuestions) {
    questions[`${prefix}_classification`] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.classification,
      ANALYSIS_INPUT_CLASSIFICATION_CRITERIA,
    );
    questions[`${prefix}_explicitness`] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.explicitness,
      {
        user_explicit: "ユーザーが対象・極性・条件を直接述べている。",
        user_confirmed: "以前のレビューでユーザーが確認済みである。",
        inferred: "原文に基づく意味の推測が必要である。",
        model_knowledge: "ユーザー原文ではなくモデル知識だけに基づく。",
        no_match: "候補を支持する様式がない。",
      },
    );
    if (input.includePreferenceQuestions.polarity)
      questions[`${prefix}_polarity`] = choiceQuestion(
        ANALYSIS_JUDGMENT_PROMPTS.polarity,
        {
          positive: "対象への好意・魅力・関心を表す。",
          negative: "対象への苦手・嫌悪・拒否を表す。",
          mixed: "同じ対象・条件に肯定と否定がともに明示される。",
          no_match: "極性を確認できない。",
        },
      );
    if (input.includePreferenceQuestions.strength !== undefined)
      questions[`${prefix}_strength`] = scoreQuestion(
        ANALYSIS_JUDGMENT_PROMPTS.strength,
        ["弱い反応 (0.3)", "通常の好き・苦手、または程度指定なし (0.6)", "強い反応 (0.8)", "最も強いと明示 (0.95)"],
      );
    if (input.includePreferenceQuestions.responseChannel !== undefined) {
      const catalog = input.domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog;
      questions[`${prefix}_channel`] = choiceQuestion(
        ANALYSIS_JUDGMENT_PROMPTS.responseChannel(input.domain),
        {
          ...Object.fromEntries(catalog.map((item) => [item.value, `${item.label}: ${item.description}`])),
          no_match: "原文から特定の反応経路を確認できない。",
        },
      );
    }
  }

  const fakeAnswers: Record<string, JudgmentAnswer> = {
    [`${prefix}_scope`]: fakeChoice(questions, `${prefix}_scope`, "consistent"),
  };
  assertion.evidence.forEach((reference, index) => {
    fakeAnswers[`${prefix}_evidence_${index}`] = fakeChoice(
      questions,
      `${prefix}_evidence_${index}`,
      reference.sourceRef === "model_knowledge" ? "unverifiable" : "supported",
    );
  });
  if (assertion.evidence.length > 1) fakeAnswers[`${prefix}_set`] = fakeChoice(questions, `${prefix}_set`, "supported");
  if (input.attributes?.length)
    fakeAnswers[`${prefix}_attribute`] = fakeChoice(
      questions,
      `${prefix}_attribute`,
      input.attributes.some((item) => item.stable_key === (input.proposition as { attributeStableKey?: string | null }).attributeStableKey)
        ? ((input.proposition as { attributeStableKey: string }).attributeStableKey ?? "no_match")
        : "no_match",
    );
  if (input.includePreferenceQuestions) {
    fakeAnswers[`${prefix}_classification`] = fakeChoice(
      questions,
      `${prefix}_classification`,
      input.includePreferenceQuestions.classification,
    );
    fakeAnswers[`${prefix}_explicitness`] = fakeChoice(
      questions,
      `${prefix}_explicitness`,
      assertion.explicitness,
    );
    if (input.includePreferenceQuestions.polarity)
      fakeAnswers[`${prefix}_polarity`] = fakeChoice(
        questions,
        `${prefix}_polarity`,
        input.includePreferenceQuestions.polarity,
      );
    if (input.includePreferenceQuestions.strength !== undefined)
      fakeAnswers[`${prefix}_strength`] = fakeScore(
        questions,
        `${prefix}_strength`,
        closestStrengthIndex(input.includePreferenceQuestions.strength),
      );
    if (input.includePreferenceQuestions.responseChannel !== undefined)
      fakeAnswers[`${prefix}_channel`] = fakeChoice(
        questions,
        `${prefix}_channel`,
        input.includePreferenceQuestions.responseChannel ?? "no_match",
      );
  }
  return provider.evaluate({
    state: {
      candidate: input.proposition,
      sourceContext: input.sourceContext,
      attributeCandidates: input.attributes?.map((item) => ({
        stableKey: item.stable_key,
        label: item.label,
        category: item.category,
      })),
    },
    questions,
    context: { correlationId: input.correlationId, stage: input.stage, domain: input.domain },
    fakeAnswers,
  });
}

function inferAspect(assertion: UnderstandingCandidate["assertions"][number]): UnderstandingAspect | null {
  const key = assertion.attributeStableKey ?? "";
  if (/(^|\.)role\.|\.archetype\./u.test(key)) return "narrativeRole";
  if (/(^|\.)(morality|goodness|evil)\.|\.harm\./u.test(key)) return "moralityOrientation";
  if (/(^|\.)motivation\./u.test(key)) return "goals";
  if (/(^|\.)value\.|\.morality\./u.test(key)) return "values";
  if (/(^|\.)relationship\./u.test(key)) return "relationships";
  if (/(^|\.)aesthetic\.|\.expression\.|\.competence\./u.test(key)) return "expression";
  return "behavior";
}

async function assessUnderstandingAspects(
  provider: JudgmentProvider,
  candidate: UnderstandingCandidate,
  correlationId: string,
  domain: AnalysisDomain,
  stage: string,
  issues: string[],
): Promise<AspectAssessments> {
  const mapped = new Map<UnderstandingAspect, number[]>(understandingAspects.map((aspect) => [aspect, []]));
  const assignments = await Promise.all(
    candidate.assertions.map(async (assertion, index) => {
      const id = "aspect";
      const questions = {
        [id]: choiceQuestion(
          ANALYSIS_JUDGMENT_PROMPTS.aspectAssignment,
          {
            ...Object.fromEntries(understandingAspects.map((aspect) => [aspect, understandingAspectLabels[aspect]])),
            none: "人物像の7項目の具体的説明にはならない。",
          },
        ),
      };
      const fallback = inferAspect(assertion) ?? "none";
      const result = await provider.evaluate({
        state: { assertion: { index, rawLabel: assertion.rawLabel, valueText: assertion.valueText } },
        questions,
        context: { correlationId, stage: `${stage}:aspect`, domain },
        fakeAnswers: { [id]: fakeChoice(questions, id, fallback) },
      });
      if (!isCertainChoice(result.answers[id])) issues.push(`assertion:${index}: 人物像の対応項目を確定できません。`);
      return isCertainChoice(result.answers[id]) ? result.answers[id].choice : "none";
    }),
  );
  assignments.forEach((aspect, index) => {
    if (understandingAspects.includes(aspect as UnderstandingAspect)) mapped.get(aspect as UnderstandingAspect)?.push(index);
  });

  const entries = await Promise.all(
    understandingAspects.map(async (aspect) => {
      const summaryIndexes = candidate.summary[aspect].flatMap((text, index) => (text.trim() ? [index] : []));
      const assertionIndexes = mapped.get(aspect) ?? [];
      if (!summaryIndexes.length)
        return [
          aspect,
          {
            kind: "unknown" as const,
            reason: "人物像の記述がありません。",
            summaryIndexes,
            assertionIndexes: [],
          },
        ] as const;
      const id = "kind";
      const questions = {
        [id]: choiceQuestion(ANALYSIS_JUDGMENT_PROMPTS.aspectInformation, {
          concrete: "行動・目的・価値・関わり方・表現等が分かる具体的描写と対応assertionがある。",
          label_only: "役割名・分類名だけで具体的描写がない。",
          attribution_only: "出所や解釈であることの注記だけで人物描写がない。",
          unknown: "内容がない。",
        }),
      };
      const fake = assertionIndexes.length ? "concrete" : "label_only";
      const result = await provider.evaluate({
        state: {
          aspect,
          summary: candidate.summary[aspect],
          assertions: assertionIndexes.map((index) => ({ index, ...candidate.assertions[index] })),
        },
        questions,
        context: { correlationId, stage: `${stage}:information`, domain },
        fakeAnswers: { [id]: fakeChoice(questions, id, fake) },
      });
      const kind = answerChoice(result.answers[id], "unknown") as AspectAssessments[UnderstandingAspect]["kind"];
      if (!isCertainChoice(result.answers[id])) issues.push(`${aspect}: 情報量を確定できません。`);
      return [
        aspect,
        {
          kind,
          reason: `項目の情報量判定: ${kind}`,
          summaryIndexes,
          assertionIndexes: kind === "concrete" ? assertionIndexes : [],
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as AspectAssessments;
}

async function understandingCoverageIssues(
  provider: JudgmentProvider,
  candidate: UnderstandingCandidate,
  payload: AnyEntryDraft,
  research: CharacterResearch,
  correlationId: string,
  domain: AnalysisDomain,
  stage: string,
) {
  const sources = sourceChunks([
    ...sourceInputs(payload, false),
    ...research.sources.map((source) => ({
      pointer: source.url,
      label: source.title,
      text: source.excerpt,
      start: 0,
      end: source.excerpt.length,
    })),
  ]);
  const results = await Promise.all(
    sources.map(async (source, sourceIndex) => {
      const questions = Object.fromEntries(
        understandingAspects.map((aspect) => [
          aspect,
          noulQuestion(
            ANALYSIS_JUDGMENT_PROMPTS.understandingCoverage(understandingAspectLabels[aspect], aspect),
          ),
        ]),
      );
      const fakeAnswers = Object.fromEntries(
        understandingAspects.map((aspect) => [aspect, { type: "noul" as const, noul: 0 }]),
      );
      const result = await provider.evaluate({
        state: {
          source: { ...source, sourceIndex },
          candidate: {
            summary: candidate.summary,
            assertions: candidate.assertions.map((item) => ({ rawLabel: item.rawLabel, valueText: item.valueText })),
          },
        },
        questions,
        context: { correlationId, stage: `${stage}:coverage`, domain },
        fakeAnswers,
      });
      return understandingAspects.flatMap((aspect) => {
        const answer = result.answers[aspect];
        return !isCertainNoul(answer) || (answer.type === "noul" && answer.noul >= 0.9)
          ? [`${aspect}: 原文にある人物描写の取りこぼし、または判定の不確実性があります。`]
          : [];
      });
    }),
  );
  return [...new Set(results.flat())];
}

export async function judgeUnderstandingCandidate(
  env: Env,
  input: {
    candidate: UnderstandingCandidate | DarkUnderstandingCandidate;
    payload: AnyEntryDraft;
    ontology: AttributeRow[];
    research: CharacterResearch;
    correlationId: string;
    stage: string;
    domain: AnalysisDomain;
    provenanceSources?: ProvenanceSource[];
  },
) {
  const provider = createJudgmentProvider(env);
  const issues: string[] = [];
  const inputs = sourceInputs(input.payload, false).map((source) => ({ ...source, url: null }));
  const research = input.research.sources.map((source) => ({
    pointer: null,
    url: source.url,
    label: source.title,
    text: source.excerpt,
    start: 0,
    end: source.excerpt.length,
  }));
  const sources = [
    ...inputs,
    ...research,
    ...(input.provenanceSources ?? []).map((source) => ({
      pointer: source.inputPointer,
      url: source.url,
      label: source.sourceId,
      text: source.text,
      start: 0,
      end: source.text.length,
    })),
  ];
  const judged = await Promise.all(
    input.candidate.assertions.map(async (assertion, index) => {
      const prefix = `assertion_${index}`;
      const result = await judgeAssertion(provider, {
        correlationId: input.correlationId,
        stage: `${input.stage}:assertion`,
        domain: input.domain,
        prefix,
        assertion,
        proposition: assertion,
        sourceContext: {
          evidence: assertion.evidence,
          sources: assertion.evidence.flatMap((reference) => relevantSourceText(reference, sources)),
        },
        attributes: attributeCandidates(
          `${assertion.rawLabel} ${assertion.valueText}`,
          assertion.attributeStableKey,
          input.ontology,
        ),
      });
      const attributeAnswer = result.answers[`${prefix}_attribute`];
      const attributeChoice = answerChoice(attributeAnswer, "no_match");
      const attributeStableKey = input.ontology.some((item) => item.stable_key === attributeChoice)
        ? attributeChoice
        : null;
      if (attributeAnswer && !isCertainChoice(attributeAnswer)) issues.push(`${prefix}: 統制属性の対応を確定できません。`);
      return {
        assertion: {
          ...assertion,
          attributeStableKey,
          confidence: explicitnessConfidence(assertion.explicitness, assertion.confidence),
        },
        fields: semanticFields(
          assertion,
          result.answers,
          prefix,
          { evaluated: assertion.valueText, actor: input.payload.characterName, target: assertion.scopeText },
          issues,
        ),
      };
    }),
  );
  const candidate: UnderstandingCandidate | DarkUnderstandingCandidate = {
    ...input.candidate,
    assertions: judged.map((item) => item.assertion),
  };
  const aspectAssessments = await assessUnderstandingAspects(
    provider,
    candidate,
    input.correlationId,
    input.domain,
    input.stage,
    issues,
  );
  issues.push(
    ...(await understandingCoverageIssues(
      provider,
      candidate,
      input.payload,
      input.research,
      input.correlationId,
      input.domain,
      input.stage,
    )),
  );
  const audit = {
    ...candidate,
    aspectAssessments,
    assertions: judged.map((item) => ({ ...item.assertion, ...item.fields })),
  } as GroundedUnderstandingAudit;
  return { candidate, audit, issues: [...new Set(issues)] };
}

function preferenceProposition(item: {
  rawLabel: string;
  polarity: string;
  context: { subjects: string[]; exceptions: string[] } & Record<string, unknown>;
}) {
  const subjects = item.context.subjects;
  return {
    evaluated: `${item.rawLabel} / ${item.polarity} / ${JSON.stringify(item.context)}`,
    actor: subjects[0] ?? null,
    target: subjects[1] ?? null,
    negated: item.context.exceptions.length ? item.context.exceptions.join("、") : null,
  };
}

async function preferenceCoverageIssues(
  provider: JudgmentProvider,
  candidate: AnyPreferenceCandidate,
  payload: AnyEntryDraft,
  correlationId: string,
  domain: AnalysisDomain,
) {
  const results = await Promise.all(
    sourceChunks(sourceInputs(payload, true)).map(async (source, index) => {
      const questions = {
        preference_omission: noulQuestion(
          ANALYSIS_JUDGMENT_PROMPTS.preferenceCoverage,
        ),
        stance_omission: noulQuestion(
          ANALYSIS_JUDGMENT_PROMPTS.stanceCoverage,
        ),
      };
      const result = await provider.evaluate({
        state: {
          source: { ...source, index },
          candidate: {
            preferenceAssertions: candidate.preferenceAssertions,
            valueStanceAssertions: candidate.valueStanceAssertions,
            uncertainties: candidate.uncertainties,
          },
        },
        questions,
        context: { correlationId, stage: "preference:coverage", domain },
        fakeAnswers: {
          preference_omission: { type: "noul", noul: 0 },
          stance_omission: { type: "noul", noul: 0 },
        },
      });
      return Object.entries({
        preference_omission: "好み・苦手",
        stance_omission: "価値態度",
      }).flatMap(([id, label]) => {
        const answer = result.answers[id];
        return !isCertainNoul(answer) || (answer.type === "noul" && answer.noul >= 0.9)
          ? [`preference-source-${index}:${id}: 原文側に未反映の${label}、または判定の不確実性があります。`]
          : [];
      });
    }),
  );
  return results.flat();
}

export async function judgePreferenceCandidate(
  env: Env,
  input: {
    candidate: AnyPreferenceCandidate;
    payload: AnyEntryDraft;
    ontology: AttributeRow[];
    provenanceSources: ProvenanceSource[];
    correlationId: string;
    domain: AnalysisDomain;
  },
): Promise<PreferenceJudgment> {
  const provider = createJudgmentProvider(env);
  const issues: string[] = [];
  const sources = input.provenanceSources.map((source) => ({
    pointer: source.inputPointer,
    url: source.url,
    label: source.sourceId,
    text: source.text,
  }));
  const preferences = await Promise.all(
    input.candidate.preferenceAssertions.map(async (original, index) => {
      const prefix = `preference_${index}`;
      const result = await judgeAssertion(provider, {
        correlationId: input.correlationId,
        stage: "preference:assertion",
        domain: input.domain,
        prefix,
        assertion: original,
        proposition: original,
        sourceContext: {
          evidence: original.evidence,
          sources: original.evidence.flatMap((reference) => relevantSourceText(reference, sources)),
        },
        attributes: attributeCandidates(original.rawLabel, original.attributeStableKey, input.ontology),
        includePreferenceQuestions: {
          classification: "preference",
          responseChannel: original.responseChannel,
          strength: original.strength,
          polarity: original.polarity,
        },
      });
      const classification = answerChoice(result.answers[`${prefix}_classification`], "no_match");
      const protectedByReview = original.explicitness === "user_confirmed";
      if (!protectedByReview && (!isCertainChoice(result.answers[`${prefix}_classification`]) || classification !== "preference"))
        issues.push(`${prefix}: 入力事実と嗜好反応を区別できません。`);
      const attributeAnswer = result.answers[`${prefix}_attribute`];
      const attributeChoice = answerChoice(attributeAnswer, "no_match");
      const attributeStableKey = input.ontology.some((item) => item.stable_key === attributeChoice)
        ? attributeChoice
        : null;
      if (!protectedByReview && attributeAnswer && !isCertainChoice(attributeAnswer))
        issues.push(`${prefix}: 統制属性の対応を確定できません。`);
      const explicitnessAnswer = result.answers[`${prefix}_explicitness`];
      const judgedExplicitness = answerChoice(explicitnessAnswer, "no_match");
      const explicitness =
        original.explicitness === "user_confirmed"
          ? "user_confirmed"
          : ["user_explicit", "inferred", "model_knowledge"].includes(judgedExplicitness)
            ? (judgedExplicitness as typeof original.explicitness)
            : original.explicitness;
      if (!protectedByReview && (!isCertainChoice(explicitnessAnswer) || judgedExplicitness === "no_match"))
        issues.push(`${prefix}: 支持様式を確定できません。`);
      const polarityAnswer = result.answers[`${prefix}_polarity`];
      const polarityChoice = answerChoice(polarityAnswer, "no_match");
      const polarity = ["positive", "negative", "mixed"].includes(polarityChoice)
        ? (polarityChoice as typeof original.polarity)
        : original.polarity;
      if (!protectedByReview && (!isCertainChoice(polarityAnswer) || polarityChoice === "no_match"))
        issues.push(`${prefix}: 極性を確定できません。`);
      const channelAnswer = result.answers[`${prefix}_channel`];
      const channelChoice = answerChoice(channelAnswer, "no_match");
      const allowedChannels = new Set<string>(
        (input.domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog).map((item) => item.value),
      );
      const responseChannel = allowedChannels.has(channelChoice)
        ? (channelChoice as typeof original.responseChannel)
        : null;
      const strengthAnswer = result.answers[`${prefix}_strength`];
      const strength = isCertainScore(strengthAnswer)
        ? STRENGTH_ANCHORS[Math.max(0, Math.min(3, Math.round(strengthAnswer.score)))]
        : STRENGTH_ANCHORS[closestStrengthIndex(original.strength)];
      if (!protectedByReview && !isCertainScore(strengthAnswer)) issues.push(`${prefix}: 反応強度を確定できません。`);
      const item = (protectedByReview
        ? original
        : {
            ...original,
            attributeStableKey,
            polarity,
            responseChannel,
            strength,
            explicitness,
            confidence: explicitnessConfidence(explicitness, original.confidence),
          }) as typeof original;
      const changed =
        item.attributeStableKey !== original.attributeStableKey ||
        item.polarity !== original.polarity ||
        item.responseChannel !== original.responseChannel ||
        item.strength !== original.strength;
      const validation = changed
        ? await judgeAssertion(provider, {
            correlationId: input.correlationId,
            stage: "preference:projected-assertion",
            domain: input.domain,
            prefix: `${prefix}_projected`,
            assertion: item,
            proposition: item,
            sourceContext: {
              evidence: item.evidence,
              sources: item.evidence.flatMap((reference) => relevantSourceText(reference, sources)),
            },
          })
        : result;
      const validationPrefix = changed ? `${prefix}_projected` : prefix;
      const fields = semanticFields(item, validation.answers, validationPrefix, preferenceProposition(item), issues);
      if (classification !== "preference" && !protectedByReview) {
        fields.scopeAssessment.verdict = "mismatch";
        fields.scopeAssessment.reason = `入力記述の分類が嗜好反応ではありません: ${classification}`;
      }
      return { item, fields };
    }),
  );
  const stances = await Promise.all(
    input.candidate.valueStanceAssertions.map(async (original, index) => {
      const prefix = `stance_${index}`;
      const result = await judgeAssertion(provider, {
        correlationId: input.correlationId,
        stage: "preference:value-stance",
        domain: input.domain,
        prefix,
        assertion: original,
        proposition: original,
        sourceContext: {
          evidence: original.evidence,
          sources: original.evidence.flatMap((reference) => relevantSourceText(reference, sources)),
        },
        includePreferenceQuestions: {
          classification: "value_attitude",
        },
      });
      const classification = answerChoice(result.answers[`${prefix}_classification`], "no_match");
      const protectedByReview = original.explicitness === "user_confirmed";
      if (!protectedByReview && (!isCertainChoice(result.answers[`${prefix}_classification`]) || classification !== "value_attitude"))
        issues.push(`${prefix}: 価値態度と人物事実・嗜好・自己経験を区別できません。`);
      const explicitnessAnswer = result.answers[`${prefix}_explicitness`];
      const judgedExplicitness = answerChoice(explicitnessAnswer, "no_match");
      const explicitness =
        original.explicitness === "user_confirmed"
          ? "user_confirmed"
          : ["user_explicit", "inferred"].includes(judgedExplicitness)
            ? (judgedExplicitness as typeof original.explicitness)
            : original.explicitness;
      const item = protectedByReview
        ? original
        : { ...original, explicitness, confidence: explicitnessConfidence(explicitness, original.confidence) };
      const fields = semanticFields(
        original,
        result.answers,
        prefix,
        {
          evaluated: `${item.targetType}:${item.targetRef} / ${item.stance} / ${item.orientation}`,
          actor: item.context.subjects[0] ?? null,
          target: item.targetRef,
          negated: item.context.exceptions.length ? item.context.exceptions.join("、") : null,
        },
        issues,
      );
      if (classification !== "value_attitude" && !protectedByReview) {
        fields.scopeAssessment.verdict = "mismatch";
        fields.scopeAssessment.reason = `入力記述の分類が価値態度ではありません: ${classification}`;
      }
      return { item, fields };
    }),
  );
  issues.push(...(await preferenceCoverageIssues(provider, input.candidate, input.payload, input.correlationId, input.domain)));
  const candidate = {
    ...input.candidate,
    preferenceAssertions: preferences.map((item) => item.item),
    valueStanceAssertions: stances.map((item) => item.item),
  } as AnyPreferenceCandidate;
  const audited = {
    ...candidate,
    preferenceAssertions: preferences.map(({ item, fields }) => ({ ...item, ...fields })),
    valueStanceAssertions: stances.map(({ item, fields }) => ({ ...item, ...fields })),
  } as AuditedPreferenceCandidate;
  return { candidate, audited, issues: [...new Set(issues)] };
}

export async function judgeDarkTransformationDeltas(
  env: Env,
  input: {
    deltas: DarkTransformationDelta[];
    baseline: unknown;
    payload: AnyEntryDraft;
    correlationId: string;
  },
) {
  const provider = createJudgmentProvider(env);
  const issues: string[] = [];
  const judged = await Promise.all(
    input.deltas.map(async (delta, index) => {
      const questions = {
        verdict: choiceQuestion(
          ANALYSIS_JUDGMENT_PROMPTS.darkDelta,
          { supported: "差分が入力に支持される。", contradicted: "差分が入力と矛盾する。", uncertain: "入力だけでは差分を確認できない。" },
        ),
      };
      const result = await provider.evaluate({
        state: { delta, baseline: input.baseline, darkInputs: sourceInputs(input.payload, false) },
        questions,
        context: { correlationId: input.correlationId, stage: "dark:transformation-delta", domain: "dark" },
        fakeAnswers: { verdict: fakeChoice(questions, "verdict", "supported") },
      });
      const answer = result.answers.verdict;
      const verdict = answerChoice(answer, "uncertain");
      if (!isCertainChoice(answer) || verdict !== "supported") issues.push(`dark-delta-${index}: ダーク差分を確認できません。`);
      return verdict === "supported" ? [delta] : [];
    }),
  );
  return { deltas: judged.flat(), issues };
}

export async function judgeDarkBaselineCandidate(
  env: Env,
  input: {
    candidate: DarkBaselineUnderstanding;
    payload: AnyEntryDraft;
    research: CharacterResearch;
    correlationId: string;
  },
) {
  const provider = createJudgmentProvider(env);
  const questions: Record<string, JudgmentQuestion> = {};
  const values = {
    identity: input.candidate.identity,
    narrativeRole: input.candidate.narrativeRole,
    agency: input.candidate.agency,
    moralCommitments: input.candidate.moralCommitments,
    protectedPeopleOrValues: input.candidate.protectedPeopleOrValues,
    relationships: input.candidate.relationships,
    abilitiesAndDuties: input.candidate.abilitiesAndDuties,
    selfConcept: input.candidate.selfConcept,
    priorVulnerabilities: input.candidate.priorVulnerabilities,
  };
  for (const key of Object.keys(values))
    questions[key] = choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.darkBaseline(key),
      ANALYSIS_SUPPORT_CRITERIA,
    );
  questions.coverage = noulQuestion(
    ANALYSIS_JUDGMENT_PROMPTS.darkBaselineCoverage,
  );
  const fakeAnswers = Object.fromEntries([
    ...Object.keys(values).map((key) => [key, fakeChoice(questions, key, "supported")] as const),
    ["coverage", { type: "noul" as const, noul: 0 }],
  ]);
  const result = await provider.evaluate({
    state: {
      candidate: values,
      sources: [
        ...sourceInputs(input.payload, false),
        ...input.research.sources.map((source) => ({
          label: source.title,
          pointer: source.url,
          text: source.excerpt,
          start: 0,
          end: source.excerpt.length,
        })),
      ],
      evidence: input.candidate.evidence,
    },
    questions,
    context: { correlationId: input.correlationId, stage: "dark:baseline", domain: "dark" },
    fakeAnswers,
  });
  const issues = Object.keys(values).flatMap((key) => {
    const answer = result.answers[key];
    const verdict = answerChoice(answer, "unverifiable");
    return !isCertainChoice(answer) || ["contradicted", "unsupported", "unverifiable"].includes(verdict)
      ? [`dark-baseline:${key}: 変化前の人物像を根拠から確認できません。`]
      : [];
  });
  const coverage = result.answers.coverage;
  if (!isCertainNoul(coverage) || (coverage.type === "noul" && coverage.noul >= 0.9))
    issues.push("dark-baseline:coverage: 変化前の人物像に原文からの取りこぼし、または判定の不確実性があります。");
  return { candidate: input.candidate, issues };
}

export async function judgeDarkScopeCandidate(
  env: Env,
  input: {
    candidate: DarkScopeAssessment;
    payload: AnyEntryDraft;
    research: CharacterResearch;
    correlationId: string;
  },
) {
  const provider = createJudgmentProvider(env);
  const questions = {
    verdict: choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.darkScope,
      {
        in_scope: "dark専用の人物・状態・変化として明確に分析対象となる。",
        borderline: "一部は該当するが、範囲や状態の追加確認が必要である。",
        out_of_scope: "dark専用分析の対象となる根拠がない。",
      },
    ),
    support: choiceQuestion(
      ANALYSIS_JUDGMENT_PROMPTS.darkScopeSupport,
      ANALYSIS_SUPPORT_CRITERIA,
    ),
  };
  const result = await provider.evaluate({
    state: {
      candidate: input.candidate,
      sources: [
        ...sourceInputs(input.payload, false),
        ...input.research.sources.map((source) => ({
          label: source.title,
          pointer: source.url,
          text: source.excerpt,
          start: 0,
          end: source.excerpt.length,
        })),
      ],
    },
    questions,
    context: { correlationId: input.correlationId, stage: "dark:scope", domain: "dark" },
    fakeAnswers: {
      verdict: fakeChoice(questions, "verdict", input.candidate.verdict),
      support: fakeChoice(questions, "support", "supported"),
    },
  });
  const verdictAnswer = result.answers.verdict;
  const supportAnswer = result.answers.support;
  const verdict = answerChoice(verdictAnswer, "borderline") as DarkScopeAssessment["verdict"];
  const support = answerChoice(supportAnswer, "unverifiable");
  const issues = [
    ...(!isCertainChoice(verdictAnswer) ? ["dark-scope: 範囲判定を確定できません。"] : []),
    ...(!isCertainChoice(supportAnswer) || support !== "supported"
      ? ["dark-scope: 登録情報から範囲判定の根拠を確認できません。"]
      : []),
  ];
  return {
    candidate: {
      ...input.candidate,
      verdict,
      limitations: [...input.candidate.limitations, ...issues.map(analysisIssueText)].slice(-20),
    },
    issues,
  };
}

async function selectSuggestions<T>(
  provider: JudgmentProvider,
  candidates: T[],
  state: Record<string, unknown>,
  context: { correlationId: string; stage: string; domain: AnalysisDomain },
  kind: "question" | "hypothesis",
  maximum: number,
): Promise<T[]> {
  const questions = {
    relevant: noulQuestion(ANALYSIS_JUDGMENT_PROMPTS.suggestionRelevance(kind)),
    impact: scoreQuestion(ANALYSIS_JUDGMENT_PROMPTS.suggestionImpact, ["影響なし", "小さい", "有用", "重要な解釈を変える"]),
    answerability: scoreQuestion(ANALYSIS_JUDGMENT_PROMPTS.suggestionAnswerability, ["回答不能", "大きな負担", "具体的に回答可能", "一回答で明確になる"]),
  };
  const outcomes = await Promise.allSettled(candidates.map(async (candidate, index) => {
    const result = await provider.evaluate({
      state: { ...state, candidate, alternatives: candidates },
      questions,
      context,
      fakeAnswers: {
        relevant: { type: "noul", noul: 1 },
        impact: fakeScore(questions, "impact", 3),
        answerability: fakeScore(questions, "answerability", 3),
      },
    });
    const { relevant, impact, answerability } = result.answers;
    const accepted = isCertainNoul(relevant) && relevant.type === "noul" && relevant.noul > 0.5
      && isCertainScore(impact) && impact.score >= 2
      && isCertainScore(answerability) && answerability.score >= 2;
    return { candidate, index, accepted, impact: impact.type === "score" ? impact.score : 0,
      answerability: answerability.type === "score" ? answerability.score : 0 };
  }));
  const ranked = outcomes.map((outcome) => {
    if (outcome.status === "rejected") throw outcome.reason;
    return outcome.value;
  }).filter((item) => item.accepted)
    .sort((left, right) => right.impact - left.impact || right.answerability - left.answerability || left.index - right.index);
  const selected: T[] = [];
  for (const { candidate } of ranked) {
    if (selected.length >= maximum) break;
    if (selected.length) {
      // This question depends on the earlier ranking/selection, so it is a separate call.
      const result = await provider.evaluate({
        state: { candidate, selected },
        questions: { duplicate: noulQuestion(ANALYSIS_JUDGMENT_PROMPTS.suggestionDuplicate) },
        context: { ...context, stage: `${context.stage}:duplicate` },
        fakeAnswers: { duplicate: { type: "noul", noul: selected.some((item) => JSON.stringify(item) === JSON.stringify(candidate)) ? 1 : 0 } },
      });
      const duplicate = result.answers.duplicate;
      if (!isCertainNoul(duplicate) || duplicate.type !== "noul" || duplicate.noul > 0.5) continue;
    }
    selected.push(candidate);
  }
  return selected;
}

export async function rankPreferenceQuestions(
  env: Env,
  input: {
    uncertainties: PreferenceCandidate["uncertainties"];
    payload: AnyEntryDraft;
    correlationId: string;
    domain: AnalysisDomain;
  },
) {
  const candidates = input.uncertainties.filter((item) => item.recommendedQuestion);
  const selected = new Set(await selectSuggestions(
    createJudgmentProvider(env), candidates,
    { preferenceInput: sourceInputs(input.payload, true) },
    { correlationId: input.correlationId, stage: "preference:question-ranking", domain: input.domain },
    "question", 3,
  ));
  // Preserve every unresolved topic; only the suggested question is selected or withheld.
  return [...input.uncertainties]
    .sort((left, right) => Number(selected.has(right)) - Number(selected.has(left)))
    .map((item) => ({ ...item, recommendedQuestion: selected.has(item) ? item.recommendedQuestion : null }));
}

export async function rankPreferenceHypotheses(
  env: Env,
  input: {
    candidates: PreferenceHypothesis[];
    payload: AnyEntryDraft;
    understanding: UnderstandingCandidate;
    existingPreferences: unknown;
    correlationId: string;
    domain: AnalysisDomain;
  },
) {
  return selectSuggestions(
    createJudgmentProvider(env), input.candidates,
    {
      registration: sourceInputs(input.payload, false),
      understanding: {
        summary: input.understanding.summary,
        assertions: input.understanding.assertions.map((item) => ({
          attributeStableKey: item.attributeStableKey, rawLabel: item.rawLabel, valueText: item.valueText,
        })),
      },
      existingPreferences: input.existingPreferences,
    },
    { correlationId: input.correlationId, stage: "preference:hypothesis-ranking", domain: input.domain },
    "hypothesis", 6,
  );
}
