import { z } from "zod";
import { type UnderstandingCandidate, understandingCandidateSchema } from "../../../shared/contracts/understanding";
import {
  entryBaseCharacterName,
  entryInputSources,
  entryPreferenceContext,
  entryReferenceMaterial,
} from "../../../shared/entry-input";
import { hmacHex, sha256Hex } from "../../lib/crypto";
import { SYSTEM_INSTRUCTION } from "../../llm/prompts/analysis";
import { LlmProviderError, type StructuredLlmResult } from "../../llm/types";
import type { Env } from "../../types";
import { ontologyPrompt } from "./context";
import { fakeUnderstanding } from "./deterministic";
import type { CharacterResearch } from "./research";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { AttributeRow, EntryContext } from "./types";
import {
  explainUnknownUnderstandingAspects,
  UNDERSTANDING_COMPLETENESS_INSTRUCTION,
  understandingQualityIssues,
} from "./understanding-quality";

export async function understandOne(
  env: Env,
  entry: EntryContext,
  representationId: string,
  stage: "base" | "target",
  ontology: AttributeRow[],
  research: CharacterResearch,
  baseSummary?: UnderstandingCandidate,
) {
  const includeCustomization = stage === "target";
  const isCustomizedBase = entry.payload.registrationType === "customized_existing" && stage === "base";
  const analysisTargetName = isCustomizedBase ? entryBaseCharacterName(entry.payload) : entry.payload.characterName;
  const sourcePayload = {
    registrationType: entry.payload.registrationType,
    workTitle: entry.payload.registrationType === "original" ? undefined : entry.payload.workTitle,
    baseCharacterName:
      entry.payload.registrationType === "customized_existing" ? entryBaseCharacterName(entry.payload) : undefined,
    characterName: isCustomizedBase ? undefined : entry.payload.characterName,
    analysisTargetName,
    mediaType: entry.payload.registrationType === "original" ? undefined : entry.payload.mediaType,
    characterBasicInfo: entry.payload.registrationType === "original" ? entry.payload.characterBasicInfo : undefined,
    preferenceContext: isCustomizedBase ? undefined : entryPreferenceContext(entry.payload),
    referenceMaterial: entryReferenceMaterial(entry.payload),
    userCharacterView: isCustomizedBase ? undefined : entry.payload.userCharacterView,
    customizationDescription:
      entry.payload.registrationType === "customized_existing" && stage === "target"
        ? entry.payload.customizationDescription
        : undefined,
  };
  const sourcePayloadValues = sourcePayload as Record<string, unknown>;
  const allowedInputPointers = entryInputSources(entry.payload)
    .filter((source) => sourcePayloadValues[source.pointer.slice(1)] !== undefined)
    .map((source) => source.pointer);
  const messages = [
    { role: "system" as const, content: `${SYSTEM_INSTRUCTION}\n${UNDERSTANDING_COMPLETENESS_INSTRUCTION}` },
    {
      role: "user" as const,
      content: `次の対象を分析してください。\n対象stage: ${stage}\n分析対象名: ${analysisTargetName}\n登録情報: ${JSON.stringify(sourcePayload)}\n入力根拠に使用できるJSON Pointer: ${JSON.stringify(allowedInputPointers)}\nシステム収集済み公開情報: ${JSON.stringify(research)}\n既成キャラクターの一般的な基本像は、システム収集済み公開情報と利用可能なモデル知識から構成してください。既成（カスタム）のbase stageではbaseCharacterNameを元キャラクターの名前として基本像を構成し、target stageではcharacterNameをカスタム後の名前として扱ってください。オリジナルキャラクターの一般的な基本像はcharacterBasicInfoから構成してください。referenceMaterialはユーザーが任意提供した補足情報、userCharacterViewはユーザー自身の解釈として、出所を混同しないでください。検索結果が対象と一致しない、情報が競合する、または根拠が弱い場合は断定せずlimitationsまたはuncertaintiesへ記録してください。\n嗜好入力は意図的に含めていません。キャラクターの事実・解釈と、ユーザーが好きな属性を混同しないでください。\n${baseSummary ? `確認前の基本像: ${JSON.stringify(baseSummary.summary)}` : ""}\n利用可能な統制属性:\n${ontologyPrompt(ontology)}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const attempts: NonNullable<StructuredLlmResult<UnderstandingCandidate>["attempts"]> = [];
  const citations: NonNullable<StructuredLlmResult<UnderstandingCandidate>["metadata"]["citations"]> = [];
  async function recordCall(request: Parameters<typeof entry.llm.generateStructured<UnderstandingCandidate>>[0]) {
    try {
      const result = await entry.llm.generateStructured(request);
      attempts.push(...(result.attempts ?? [{ output: result.value, metadata: result.metadata }]));
      citations.push(...(result.metadata.citations ?? []));
      return result;
    } catch (error) {
      if (error instanceof LlmProviderError) error.attempts = [...attempts, ...error.attempts];
      throw error;
    }
  }
  const result = await recordCall({
    operation: includeCustomization ? "customization_delta" : "character_understanding",
    schemaName: "character_understanding_candidate",
    schemaVersion: "1.0",
    schema: understandingCandidateSchema,
    jsonSchema: z.toJSONSchema(understandingCandidateSchema, {
      target: "draft-7",
    }) as Record<string, unknown>,
    messages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: includeCustomization ? 0 : 0.1,
    idempotencyKey: `${entry.entryRevisionId}:${stage}`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    enableWebSearch:
      entry.payload.registrationType === "existing" ||
      (entry.payload.registrationType === "customized_existing" && stage === "base"),
    fakeFactory: () => fakeUnderstanding(entry.payload, includeCustomization),
  });
  async function audit(candidate: UnderstandingCandidate, suffix: string) {
    return recordCall({
      operation: "understanding_audit",
      schemaName: "character_understanding_candidate",
      schemaVersion: "2.0",
      schema: understandingCandidateSchema,
      jsonSchema: z.toJSONSchema(understandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
      messages: [
        { role: "system", content: `${SYSTEM_INSTRUCTION}\n${UNDERSTANDING_COMPLETENESS_INSTRUCTION}` },
        {
          role: "user",
          content: `キャラクター理解候補を元資料と照合し、根拠のない断定・カスタム差分の誤りを訂正した完全な候補を返す。新しい事実や出典を創作せず、モデル知識の確信度を上げない。候補に含まれるモデル知識は公開資料に記述がないだけでは削除せず、対象との不一致や矛盾、知識自体の不確かさがある場合に修正する。削除で空になる項目には項目別の不明理由を残す。嗜好は分析しない。\n${JSON.stringify({ stage, sourcePayload, research, candidate, citations, ontology, allowedInputPointers })}`,
        },
      ],
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      temperature: 0,
      idempotencyKey: `${entry.entryRevisionId}:${stage}:${suffix}`,
      safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
      fakeFactory: () => candidate,
    });
  }
  let audited = await audit(result.value, "audit");
  let issues = understandingQualityIssues(audited.value);
  if (issues.length) {
    const repaired = await recordCall({
      operation: includeCustomization ? "customization_delta" : "character_understanding",
      schemaName: "character_understanding_candidate",
      schemaVersion: "2.0",
      schema: understandingCandidateSchema,
      jsonSchema: z.toJSONSchema(understandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
      messages: [
        ...messages,
        {
          role: "user",
          content: `監査後の人物像に不足があります。元の登録情報を基準に再検討し、完全な候補を返してください。既成キャラクターでは利用可能な公開情報検索とモデル知識を用いて不足を補ってください。オリジナルやカスタム固有の設定は入力資料の範囲を守ってください。根拠が得られなければ項目別の不明理由を残してください。\n不足: ${JSON.stringify(issues)}\n監査後の候補: ${JSON.stringify(audited.value)}\n取得済み引用: ${JSON.stringify(citations)}`,
        },
      ],
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      temperature: 0,
      idempotencyKey: `${entry.entryRevisionId}:${stage}:complete`,
      safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
      enableWebSearch:
        entry.payload.registrationType === "existing" ||
        (entry.payload.registrationType === "customized_existing" && stage === "base"),
      fakeFactory: () => result.value,
    });
    audited = await audit(repaired.value, "complete:audit");
    issues = understandingQualityIssues(audited.value);
  }
  if (issues.length) {
    const error = new LlmProviderError(
      "キャラクター像の情報が不足しています",
      "LLM_SCHEMA_INVALID",
      false,
      `補完・再監査後もキャラクター像を構成できませんでした。参考情報や対象場面を追記して再分析してください。${issues.join("／")}`,
    );
    error.operation = "understanding_audit";
    error.attempts = attempts;
    throw error;
  }
  const value = {
    ...explainUnknownUnderstandingAspects(audited.value),
    sourceAssessment: {
      ...audited.value.sourceAssessment,
      systemResearch: {
        status: research.status,
        query: research.query,
        sources: research.sources.map(({ title, url, provider, trustReason }) => ({
          title,
          url,
          provider,
          trustReason,
        })),
        limitation: research.limitation,
      },
    },
  };
  return {
    ...audited,
    metadata: {
      ...audited.metadata,
      citations,
    },
    attempts,
    value,
    inputHash,
    representationId,
  };
}
