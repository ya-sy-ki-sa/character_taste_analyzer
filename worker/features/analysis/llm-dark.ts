import { z } from "zod";
import {
  type DarkBaselineUnderstanding,
  type DarkUnderstandingCandidate,
  darkBaselineUnderstandingSchema,
  darkScopeAssessmentSchema,
  darkUnderstandingCandidateSchema,
} from "../../../shared/contracts/dark-understanding";
import type { DarkEntryDraft } from "../../../shared/contracts/entries";
import { darkPreferenceCandidateSchema } from "../../../shared/contracts/preference";
import { darkResponseChannelPrompt } from "../../../shared/dark-response-channels";
import { entryBaseCharacterName, entryInputSources } from "../../../shared/entry-input";
import { hmacHex, sha256Hex } from "../../lib/crypto";
import { MAX_RECONSIDERATION_ROUNDS } from "../../judgment/policy";
import {
  DARK_BASELINE_SYSTEM,
  DARK_SCOPE_SYSTEM,
  DARK_UNDERSTANDING_SYSTEM,
} from "../../llm/prompts/dark";
import { PREFERENCE_SCHEMA_VERSION, preferenceSystem } from "../../llm/prompts/preference";
import type { Env } from "../../types";
import { ontologyPrompt } from "./context";
import { carryCompletedLlmGroups } from "./completed-on-error";
import {
  fakeDarkBaseline,
  fakeDarkPreferences,
  fakeDarkScopeAssessment,
  fakeDarkUnderstanding,
  refinedFakePreferences,
} from "./deterministic";
import { refinementInstruction } from "./input";
import {
  analysisIssueText,
  judgeDarkBaselineCandidate,
  judgeDarkScopeCandidate,
  judgeDarkTransformationDeltas,
  judgeUnderstandingCandidate,
} from "./judgment";
import type { CharacterResearch } from "./research";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { AttributeRow, EntryContext } from "./types";

async function afterCompletedLlm<T>(
  operation: string,
  inputHash: string,
  attempts: Array<{ output: unknown; metadata: import("../../llm/types").LlmRunMetadata }>,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (attempts.length) carryCompletedLlmGroups(error, [{ operation, inputHash, attempts: [...attempts] }]);
    throw error;
  }
}

export async function assessDarkScope(env: Env, entry: EntryContext, research: CharacterResearch) {
  const payload = entry.payload as DarkEntryDraft;
  const seed = darkScopeAssessmentSchema.parse(fakeDarkScopeAssessment(payload));
  const messages = [
    { role: "system" as const, content: DARK_SCOPE_SYSTEM },
    {
      role: "user" as const,
      content: `登録: ${JSON.stringify(payload)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  let current = seed;
  let metadata: import("../../llm/types").LlmRunMetadata | undefined;
  const attempts: Array<{ output: unknown; metadata: import("../../llm/types").LlmRunMetadata }> = [];
  let judged = await afterCompletedLlm("dark_scope_assessment", inputHash, attempts, () =>
    judgeDarkScopeCandidate(env, {
      candidate: current,
      payload,
      research,
      correlationId: entry.entryRevisionId,
    }),
  );
  for (let round = 1; judged.issues.length && round <= MAX_RECONSIDERATION_ROUNDS; round++) {
    const generated = await afterCompletedLlm("dark_scope_assessment", inputHash, attempts, async () =>
      entry.llm.generateStructured({
        operation: "dark_scope_assessment",
        schemaName: "dark_scope_assessment",
        schemaVersion: "1.0",
        schema: darkScopeAssessmentSchema,
        jsonSchema: z.toJSONSchema(darkScopeAssessmentSchema, { target: "draft-7" }) as Record<string, unknown>,
        messages: [
          ...messages,
          {
            role: "user",
            content: `範囲判定を再検討し、Schema全体を返す。再検討回数: ${round}/${MAX_RECONSIDERATION_ROUNDS}\n不足・矛盾・低確信: ${JSON.stringify(judged.issues)}\n検証後候補: ${JSON.stringify(judged.candidate)}`,
          },
        ],
        maxOutputTokens: 20_000,
        temperature: 0,
        idempotencyKey: `${entry.entryRevisionId}:dark-scope:complete:${round}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        enableWebSearch: payload.registrationType !== "original",
        fakeFactory: () => judged.candidate,
      }),
    );
    current = generated.value;
    metadata = generated.metadata;
    attempts.push(...(generated.attempts ?? [{ output: generated.value, metadata: generated.metadata }]));
    judged = await afterCompletedLlm("dark_scope_assessment", inputHash, attempts, () =>
      judgeDarkScopeCandidate(env, {
        candidate: current,
        payload,
        research,
        correlationId: entry.entryRevisionId,
      }),
    );
  }
  return { value: judged.candidate, metadata, attempts, inputHash };
}

export async function understandDarkBaseline(env: Env, entry: EntryContext, research: CharacterResearch) {
  const payload = entry.payload as DarkEntryDraft;
  const messages = [
    { role: "system" as const, content: DARK_BASELINE_SYSTEM },
    {
      role: "user" as const,
      content: `元キャラクター: ${entryBaseCharacterName(payload)}\n作品: ${payload.registrationType === "original" ? "" : payload.workTitle}\n変化前入力: ${JSON.stringify(payload.darkContext.beforeState)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  let current = await entry.llm.generateStructured({
    operation: "dark_baseline_understanding",
    schemaName: "dark_baseline_understanding",
    schemaVersion: "1.0",
    schema: darkBaselineUnderstandingSchema,
    jsonSchema: z.toJSONSchema(darkBaselineUnderstandingSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-baseline`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    enableWebSearch: true,
    fakeFactory: () => fakeDarkBaseline(payload),
  });
  const attempts = [...(current.attempts ?? [{ output: current.value, metadata: current.metadata }])];
  let judged = await afterCompletedLlm("dark_baseline_understanding", inputHash, attempts, () =>
    judgeDarkBaselineCandidate(env, {
      candidate: current.value,
      payload,
      research,
      correlationId: entry.entryRevisionId,
    }),
  );
  for (let round = 1; judged.issues.length && round <= MAX_RECONSIDERATION_ROUNDS; round++) {
    current = await afterCompletedLlm("dark_baseline_understanding", inputHash, attempts, async () =>
      entry.llm.generateStructured({
        operation: "dark_baseline_understanding",
        schemaName: "dark_baseline_understanding",
        schemaVersion: "1.0",
        schema: darkBaselineUnderstandingSchema,
        jsonSchema: z.toJSONSchema(darkBaselineUnderstandingSchema, { target: "draft-7" }) as Record<string, unknown>,
        messages: [
          ...messages,
          {
            role: "user",
            content: `変化前の元人物像を再検討し、Schema全体を返す。ダーク状態で後付けされた特徴を混ぜない。再検討回数: ${round}/${MAX_RECONSIDERATION_ROUNDS}\n不足・矛盾・低確信: ${JSON.stringify(judged.issues)}\n検証後候補: ${JSON.stringify(judged.candidate)}`,
          },
        ],
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        idempotencyKey: `${entry.entryRevisionId}:dark-baseline:complete:${round}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        enableWebSearch: true,
        fakeFactory: () => judged.candidate,
      }),
    );
    attempts.push(...(current.attempts ?? [{ output: current.value, metadata: current.metadata }]));
    judged = await afterCompletedLlm("dark_baseline_understanding", inputHash, attempts, () =>
      judgeDarkBaselineCandidate(env, {
        candidate: current.value,
        payload,
        research,
        correlationId: entry.entryRevisionId,
      }),
    );
  }
  return {
    ...current,
    value: {
      ...judged.candidate,
      uncertainties: [
        ...judged.candidate.uncertainties,
        ...judged.issues.map((reason, index) => ({
          topic: `judgment:${index + 1}`,
          reason: analysisIssueText(reason),
        })),
      ].slice(-50),
    },
    attempts,
    inputHash,
  };
}

export async function understandDarkTarget(
  env: Env,
  entry: EntryContext,
  ontology: AttributeRow[],
  research: CharacterResearch,
  baseline?: DarkBaselineUnderstanding,
) {
  const payload = entry.payload as DarkEntryDraft;
  const messages = [
    { role: "system" as const, content: DARK_UNDERSTANDING_SYSTEM },
    {
      role: "user" as const,
      content: `登録: ${JSON.stringify(payload)}\n堕落前ベースライン: ${JSON.stringify(baseline ?? null)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}\nダーク専用Ontology:\n${ontologyPrompt(ontology)}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_character_understanding",
    schemaName: "dark_character_understanding",
    schemaVersion: "1.0",
    schema: darkUnderstandingCandidateSchema,
    jsonSchema: z.toJSONSchema(darkUnderstandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-target`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    enableWebSearch: payload.registrationType === "existing",
    fakeFactory: () => fakeDarkUnderstanding(payload, baseline),
  });
  return { ...result, inputHash, representationId: entry.representationId };
}

export async function auditDarkUnderstanding(
  env: Env,
  entry: EntryContext,
  initial: Awaited<ReturnType<typeof understandDarkTarget>>,
  ontology: AttributeRow[],
  research: CharacterResearch,
  baseline?: DarkBaselineUnderstanding,
) {
  const allowedKeys = new Set(ontology.map((item) => item.stable_key));
  let current = initial;
  const attempts = [...(initial.attempts ?? [{ output: initial.value, metadata: initial.metadata }])];
  const citations = [...(initial.metadata.citations ?? [])];
  let sanitized: DarkUnderstandingCandidate = {
    ...initial.value,
    assertions: initial.value.assertions.filter(
      (item) =>
        item.attributeStableKey === null ||
        (item.attributeStableKey.startsWith("dark.") && allowedKeys.has(item.attributeStableKey)),
    ),
  };
  let judged = await afterCompletedLlm("dark_character_understanding", initial.inputHash, attempts, () =>
    judgeUnderstandingCandidate(env, {
      candidate: sanitized,
      payload: entry.payload,
      ontology,
      research,
      correlationId: entry.entryRevisionId,
      stage: "dark-target",
      domain: "dark",
    }),
  );
  let deltas = await afterCompletedLlm("dark_character_understanding", initial.inputHash, attempts, () =>
    judgeDarkTransformationDeltas(env, {
      deltas: sanitized.transformationDeltas,
      baseline,
      payload: entry.payload,
      correlationId: entry.entryRevisionId,
    }),
  );
  let issues = [...judged.issues, ...deltas.issues];
  for (let round = 1; issues.length && round <= MAX_RECONSIDERATION_ROUNDS; round++) {
    const messages = [
      { role: "system" as const, content: DARK_UNDERSTANDING_SYSTEM },
      {
        role: "user" as const,
        content: `既存候補を再検討し、Schema全体を返す。新しい事実は創作しない。\n再検討回数: ${round}/${MAX_RECONSIDERATION_ROUNDS}\n不足・矛盾・低確信: ${JSON.stringify(issues)}\n元候補: ${JSON.stringify(sanitized)}\n登録: ${JSON.stringify(entry.payload)}\n変化前ベースライン: ${JSON.stringify(baseline ?? null)}\n収集済み情報: ${JSON.stringify(research)}\n許可Ontology: ${JSON.stringify([...allowedKeys])}`,
      },
    ];
    current = {
      ...(await afterCompletedLlm("dark_character_understanding", initial.inputHash, attempts, async () =>
        entry.llm.generateStructured({
        operation: "dark_character_understanding",
        schemaName: "dark_character_understanding",
        schemaVersion: "1.0",
        schema: darkUnderstandingCandidateSchema,
        jsonSchema: z.toJSONSchema(darkUnderstandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
        messages,
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        idempotencyKey: `${entry.entryRevisionId}:dark-target:complete:${round}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        enableWebSearch: entry.payload.registrationType === "existing",
          fakeFactory: () => sanitized,
        }),
      )),
      inputHash: initial.inputHash,
      representationId: entry.representationId,
    };
    attempts.push(...(current.attempts ?? [{ output: current.value, metadata: current.metadata }]));
    citations.push(...(current.metadata.citations ?? []));
    sanitized = {
      ...current.value,
      assertions: current.value.assertions.filter(
        (item) =>
          item.attributeStableKey === null ||
          (item.attributeStableKey.startsWith("dark.") && allowedKeys.has(item.attributeStableKey)),
      ),
    };
    judged = await afterCompletedLlm("dark_character_understanding", initial.inputHash, attempts, () =>
      judgeUnderstandingCandidate(env, {
        candidate: sanitized,
        payload: entry.payload,
        ontology,
        research,
        correlationId: entry.entryRevisionId,
        stage: `dark-target:reconsider:${round}`,
        domain: "dark",
      }),
    );
    deltas = await afterCompletedLlm("dark_character_understanding", initial.inputHash, attempts, () =>
      judgeDarkTransformationDeltas(env, {
        deltas: sanitized.transformationDeltas,
        baseline,
        payload: entry.payload,
        correlationId: entry.entryRevisionId,
      }),
    );
    issues = [...judged.issues, ...deltas.issues];
  }
  const value: DarkUnderstandingCandidate = {
    ...(judged.candidate as DarkUnderstandingCandidate),
    transformationDeltas: deltas.deltas,
    uncertainties: [
      ...(judged.candidate.uncertainties ?? []),
      ...issues.map((reason, index) => ({ topic: `judgment:${index + 1}`, reason: analysisIssueText(reason) })),
    ].slice(-50),
    auditNotes: [...sanitized.auditNotes, ...issues.map(analysisIssueText)].slice(-50),
  };
  return {
    ...current,
    value,
    metadata: { ...current.metadata, citations },
    attempts,
    inputHash: initial.inputHash,
    representationId: entry.representationId,
    semanticAudit: { ...judged.audit, uncertainties: value.uncertainties },
  };
}

export async function analyzeDarkPreferences(
  env: Env,
  entry: EntryContext,
  understanding: DarkUnderstandingCandidate,
  ontology: AttributeRow[],
  runGeneration: number,
) {
  const payload = entry.payload as DarkEntryDraft;
  const messages = [
    { role: "system" as const, content: preferenceSystem("dark") },
    {
      role: "user" as const,
      content: `理解: ${JSON.stringify(understanding)}\n嗜好入力: ${JSON.stringify(payload.preference)}\n以前の好みの確認記録: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n許可Pointer: ${JSON.stringify(
        entryInputSources(payload)
          .filter((item) => item.pointer.startsWith("/preference/"))
          .map((item) => item.pointer),
      )}\n専用反応経路:\n${darkResponseChannelPrompt()}\nダーク専用Ontology:\n${ontologyPrompt(ontology)}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_preference_analysis",
    schemaName: "dark_preference_candidate",
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    schema: darkPreferenceCandidateSchema,
    jsonSchema: z.toJSONSchema(darkPreferenceCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-preference:${runGeneration}`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    fakeFactory: () => refinedFakePreferences(entry, fakeDarkPreferences(payload, understanding), understanding),
  });
  return { ...result, inputHash };
}
