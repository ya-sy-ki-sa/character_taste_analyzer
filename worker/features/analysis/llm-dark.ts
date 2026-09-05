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
import { DARK_SYSTEM_INSTRUCTION } from "../../llm/prompts/analysis";
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `この登録がダークキャラ嗜好ラボの対象か判定してください。善側の人物でも、洗脳・憑依・操作・堕落・裏切り・敵対化している限定状態なら対象です。単なる悲劇、一般的な強さ、美しさだけでは対象にしません。\n登録: ${JSON.stringify(payload)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}`,
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `既成（カスタム）の元キャラクターを、堕落前比較用のベースラインとして理解してください。通常の嗜好属性やダーク属性へmappingせず、役割、主体性、道徳的約束、守る対象、関係、能力・責務、自己認識、元からの危うさだけを抽出してください。対象状態の嗜好は含めません。\n元キャラクター: ${entryBaseCharacterName(payload)}\n作品: ${payload.registrationType === "original" ? "" : payload.workTitle}\n変化前入力: ${JSON.stringify(payload.darkContext.beforeState)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}`,
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `対象のダーク状態を専用Ontologyで分析してください。属性はdark.*だけを使用し、一般属性は単独で出力しないでください。主体性、同意、認識、抵抗、自我、責任、可逆性と時系列を明示し、ベースラインがある場合はretained/amplified/suppressed/inverted/removed/introduced/ambiguousの差分を作ってください。\n登録: ${JSON.stringify(payload)}\n堕落前ベースライン: ${JSON.stringify(baseline ?? null)}\n収集済み情報: ${JSON.stringify(research)}\n許可Pointer: ${JSON.stringify(entryInputSources(payload).map((item) => item.pointer))}\nダーク専用Ontology:\n${ontologyPrompt(ontology)}`,
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `システム収集資料: ${JSON.stringify(research)}\n次の候補を監査し、根拠のない断定を削除またはunknownへ下げた完全な改訂候補を返してください。新しい事実やURLを追加してはいけません。役割と道徳性、通常時と闇状態、本人の意思と外部支配、元からの特徴と後付け特徴を混同せず、不要な善化・悲劇化・贖罪・処罰を追加しないでください。\n元の登録情報: ${JSON.stringify(entry.payload)}\n以前の好みの確認記録（correctedを尊重しrejected/supersededを復活させない）: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え（復活させない）: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n照合資料: ${JSON.stringify(auditSources)}\n候補: ${JSON.stringify(sanitized)}\n許可Ontology: ${JSON.stringify([...allowedKeys])}`,
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `確認済みダーク状態の理解とユーザー入力から、ダーク領域に限定した嗜好候補を抽出してください。元キャラクターの通常的特徴は嗜好へ含めず、対象状態・変化差分への反応だけを扱ってください。「元の正義が残る」は自我・道徳の残存への魅力、「正義が反転した」は価値反転への魅力としてdark.*属性へ対応させます。人物への好意と行為への道徳的支持を分け、不要な善化・悲劇化・贖罪をしないでください。根拠がなければ候補0件を正常結果として返してください。\n理解: ${JSON.stringify(understanding)}\n嗜好入力: ${JSON.stringify(payload.preference)}\n以前の好みの確認記録（correctedを尊重しrejected/supersededを復活させない）: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え（復活させない）: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n許可Pointer: ${JSON.stringify(
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
    schemaVersion: "1.0",
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
    { role: "system" as const, content: DARK_SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `確認済み理解（原資料より優先）: ${JSON.stringify(understanding)}\n次のダーク嗜好候補を独立監査し、完全な改訂結果を返してください。入力根拠のない嗜好推定、通常属性、元キャラクター自体への一般嗜好、不要な善化・悲劇化を削除してください。候補0件は正常です。新しい事実・URL・入力根拠は追加しないでください。\n元の登録情報: ${JSON.stringify(entry.payload)}\n以前の好みの確認記録（correctedを尊重しrejected/supersededを復活させない）: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え（復活させない）: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n照合資料: ${JSON.stringify(auditSources)}\n候補: ${JSON.stringify(sanitized)}\n許可Ontology: ${JSON.stringify([...allowedKeys])}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
    operation: "dark_preference_audit",
    schemaName: "dark_preference_candidate",
    schemaVersion: "1.0",
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
