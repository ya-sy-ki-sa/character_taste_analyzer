import { z } from "zod";
import {
  type DarkBaselineUnderstanding,
  type DarkUnderstandingCandidate,
  darkBaselineUnderstandingSchema,
  darkScopeAssessmentSchema,
  darkUnderstandingCandidateSchema,
} from "../../../shared/contracts/dark-understanding";
import type { DarkEntryDraft } from "../../../shared/contracts/entries";
import { type DarkPreferenceCandidate, darkPreferenceCandidateSchema } from "../../../shared/contracts/preference";
import { darkResponseChannelPrompt } from "../../../shared/dark-response-channels";
import { entryBaseCharacterName, entryInputSources } from "../../../shared/entry-input";
import { hmacHex, sha256Hex } from "../../lib/crypto";
import {
  DARK_BASELINE_SYSTEM,
  DARK_SCOPE_SYSTEM,
  DARK_UNDERSTANDING_AUDIT_SYSTEM,
  DARK_UNDERSTANDING_SYSTEM,
} from "../../llm/prompts/dark";
import { PREFERENCE_SCHEMA_VERSION, preferenceSystem } from "../../llm/prompts/preference";
import { loadInputProvenanceSources } from "../../platform/provenance/sources";
import type { Env } from "../../types";
import { ontologyPrompt } from "./context";
import {
  fakeDarkBaseline,
  fakeDarkPreferences,
  fakeDarkScopeAssessment,
  fakeDarkUnderstanding,
  refinedFakePreferences,
} from "./deterministic";
import { refinementInstruction } from "./input";
import type { CharacterResearch } from "./research";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { AttributeRow, EntryContext } from "./types";

export async function assessDarkScope(env: Env, entry: EntryContext, research: CharacterResearch) {
  const payload = entry.payload as DarkEntryDraft;
  const messages = [
    { role: "system" as const, content: DARK_SCOPE_SYSTEM },
    {
      role: "user" as const,
      content: `登録: ${JSON.stringify(payload)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_scope_assessment",
    schemaName: "dark_scope_assessment",
    schemaVersion: "1.0",
    schema: darkScopeAssessmentSchema,
    jsonSchema: z.toJSONSchema(darkScopeAssessmentSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: 20_000,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-scope`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    enableWebSearch: payload.registrationType !== "original",
    fakeFactory: () => fakeDarkScopeAssessment(payload),
  });
  return { ...result, inputHash };
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
  const result = await entry.llm.generateStructured({
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
  return { ...result, inputHash };
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
  candidate: DarkUnderstandingCandidate,
  ontology: AttributeRow[],
  research: CharacterResearch,
) {
  const auditSources = await loadInputProvenanceSources(env, entry.sourceSetId);
  const allowedKeys = new Set(ontology.map((item) => item.stable_key));
  const sanitized = {
    ...candidate,
    assertions: candidate.assertions.filter(
      (item) =>
        item.attributeStableKey === null ||
        (item.attributeStableKey.startsWith("dark.") && allowedKeys.has(item.attributeStableKey)),
    ),
  };
  const messages = [
    { role: "system" as const, content: DARK_UNDERSTANDING_AUDIT_SYSTEM },
    {
      role: "user" as const,
      content: `システム収集資料: ${JSON.stringify(research)}\n元の登録情報: ${JSON.stringify(entry.payload)}\n以前の好みの確認記録: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n照合資料: ${JSON.stringify(auditSources)}\n候補: ${JSON.stringify(sanitized)}\n許可Ontology: ${JSON.stringify([...allowedKeys])}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_understanding_audit",
    schemaName: "dark_character_understanding",
    schemaVersion: "1.0",
    schema: darkUnderstandingCandidateSchema,
    jsonSchema: z.toJSONSchema(darkUnderstandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-understanding-audit`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    fakeFactory: () => ({ ...sanitized, auditNotes: [...sanitized.auditNotes, "決定論的キー監査済み"] }),
  });
  return { ...result, inputHash, representationId: entry.representationId };
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
    { role: "system" as const, content: preferenceSystem("dark", "extract") },
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

export async function auditDarkPreferences(
  env: Env,
  entry: EntryContext,
  candidate: DarkPreferenceCandidate,
  ontology: AttributeRow[],
  runGeneration: number,
  understanding: DarkUnderstandingCandidate,
) {
  const auditSources = await loadInputProvenanceSources(env, entry.sourceSetId);
  const allowedKeys = new Set(ontology.map((item) => item.stable_key));
  const sanitized: DarkPreferenceCandidate = {
    ...candidate,
    preferenceAssertions: candidate.preferenceAssertions.filter(
      (item) => item.attributeStableKey === null || allowedKeys.has(item.attributeStableKey),
    ),
  };
  const messages = [
    { role: "system" as const, content: preferenceSystem("dark", "audit") },
    {
      role: "user" as const,
      content: `確認済み理解: ${JSON.stringify(understanding)}\n元の登録情報: ${JSON.stringify(entry.payload)}\n以前の好みの確認記録: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n照合資料: ${JSON.stringify(auditSources)}\n候補: ${JSON.stringify(sanitized)}\n許可Ontology: ${JSON.stringify([...allowedKeys])}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_preference_audit",
    schemaName: "dark_preference_candidate",
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    schema: darkPreferenceCandidateSchema,
    jsonSchema: z.toJSONSchema(darkPreferenceCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:dark-preference-audit:${runGeneration}`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    fakeFactory: () => ({ ...sanitized, auditNotes: [...sanitized.auditNotes, "独立嗜好監査済み"] }),
  });
  return { ...result, inputHash };
}
