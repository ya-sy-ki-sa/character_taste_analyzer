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
import type { Env } from "../../types";
import { ontologyPrompt } from "./context";
import { fakeUnderstanding } from "./deterministic";
import type { CharacterResearch } from "./research";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { AttributeRow, EntryContext } from "./types";

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
    { role: "system" as const, content: SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `次の対象を分析してください。\n対象stage: ${stage}\n分析対象名: ${analysisTargetName}\n登録情報: ${JSON.stringify(sourcePayload)}\n入力根拠に使用できるJSON Pointer: ${JSON.stringify(allowedInputPointers)}\nシステム収集済み公開情報: ${JSON.stringify(research)}\n既成キャラクターの一般的な基本像は、システム収集済み公開情報と利用可能なモデル知識から構成してください。既成（カスタム）のbase stageではbaseCharacterNameを元キャラクターの名前として基本像を構成し、target stageではcharacterNameをカスタム後の名前として扱ってください。オリジナルキャラクターの一般的な基本像はcharacterBasicInfoから構成してください。referenceMaterialはユーザーが任意提供した補足情報、userCharacterViewはユーザー自身の解釈として、出所を混同しないでください。検索結果が対象と一致しない、情報が競合する、または根拠が弱い場合は断定せずlimitationsまたはuncertaintiesへ記録してください。\n嗜好入力は意図的に含めていません。キャラクターの事実・解釈と、ユーザーが好きな属性を混同しないでください。\n${baseSummary ? `確認前の基本像: ${JSON.stringify(baseSummary.summary)}` : ""}\n利用可能な統制属性:\n${ontologyPrompt(ontology)}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const result = await entry.llm.generateStructured({
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
  const auditMessages = [
    { role: "system" as const, content: SYSTEM_INSTRUCTION },
    {
      role: "user" as const,
      content: `キャラクター理解候補を元資料と照合し、根拠のない断定・カスタム差分の誤りを訂正した完全な候補を返す。事実や出典を追加せず、モデル知識の確信度を上げない。嗜好は分析しない。\n${JSON.stringify({ stage, sourcePayload, research, candidate: result.value, citations: result.metadata.citations ?? [], ontology, allowedInputPointers })}`,
    },
  ];
  const audited = await entry.llm.generateStructured({
    operation: "understanding_audit",
    schemaName: "character_understanding_candidate",
    schemaVersion: "2.0",
    schema: understandingCandidateSchema,
    jsonSchema: z.toJSONSchema(understandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
    messages: auditMessages,
    maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
    temperature: 0,
    idempotencyKey: `${entry.entryRevisionId}:${stage}:audit`,
    safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
    fakeFactory: () => result.value,
  });
  const value = {
    ...audited.value,
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
      citations: [...(result.metadata.citations ?? []), ...(audited.metadata.citations ?? [])],
    },
    attempts: [
      ...(result.attempts ?? [{ output: result.value, metadata: result.metadata }]),
      ...(audited.attempts ?? [{ output: audited.value, metadata: audited.metadata }]),
    ],
    value,
    inputHash,
    representationId,
  };
}
