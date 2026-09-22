import { z } from "zod";
import { type UnderstandingCandidate, understandingCandidateSchema } from "../../../shared/contracts/understanding";
import { understandingAspectLabels, understandingAspects } from "../../../shared/understanding-aspects";
import {
  entryBaseCharacterName,
  entryInputSources,
  entryPreferenceContext,
  entryReferenceMaterial,
} from "../../../shared/entry-input";
import { MAX_ANALYSIS_RECONSIDERATION_ROUNDS } from "../../judgment/policy";
import { hmacHex, sha256Hex } from "../../lib/crypto";
import { UNDERSTANDING_COMPLETION_INSTRUCTION, understandingSystem } from "../../llm/prompts/understanding";
import { LlmProviderError, type StructuredLlmResult } from "../../llm/types";
import type { Env } from "../../types";
import { isRetryableFailure } from "../jobs/policy";
import { carryCompletedLlmGroups } from "./completed-on-error";
import { ontologyPrompt } from "./context";
import { fakeUnderstanding } from "./deterministic";
import { analysisErrorCode, safeAnalysisErrorDetail } from "./failures";
import { analysisIssueText, analysisIssueTopic, judgeUnderstandingCandidate } from "./judgment";
import type { CharacterResearch } from "./research";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { AttributeRow, EntryContext, NormalizeUnderstandingAudit } from "./types";
import { UNDERSTANDING_INFORMATION_POLICY, understandingQualityIssues } from "./understanding-quality";

export async function understandOne(
  env: Env,
  entry: EntryContext,
  representationId: string,
  stage: "base" | "target",
  ontology: AttributeRow[],
  research: CharacterResearch,
  normalizeAudit: NormalizeUnderstandingAudit,
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
    { role: "system" as const, content: understandingSystem() },
    {
      role: "user" as const,
      content: `対象stage: ${stage}\n分析対象名: ${analysisTargetName}\n登録情報: ${JSON.stringify(sourcePayload)}\n入力根拠に使用できるJSON Pointer: ${JSON.stringify(allowedInputPointers)}\nシステム収集済み公開情報: ${JSON.stringify(research)}\n${baseSummary ? `確認前の基本像: ${JSON.stringify(baseSummary.summary)}` : ""}\n利用可能な統制属性:\n${ontologyPrompt(ontology)}`,
    },
  ];
  const inputHash = await sha256Hex(JSON.stringify(messages));
  const attempts: NonNullable<StructuredLlmResult<UnderstandingCandidate>["attempts"]> = [];
  const citations: NonNullable<StructuredLlmResult<UnderstandingCandidate>["metadata"]["citations"]> = [];
  async function recordCall<T extends UnderstandingCandidate>(
    request: Parameters<typeof entry.llm.generateStructured<T>>[0],
  ) {
    const metadata = (value: StructuredLlmResult<T>["metadata"]) => ({
      ...value,
      effectiveSettings: {
        ...value.effectiveSettings,
        understandingInformationPolicy: UNDERSTANDING_INFORMATION_POLICY,
        understandingSchemaVersion: request.schemaVersion,
      },
    });
    try {
      const result = await entry.llm.generateStructured(request);
      result.metadata = metadata(result.metadata);
      if (result.attempts)
        result.attempts = result.attempts.map((attempt) => ({ ...attempt, metadata: metadata(attempt.metadata) }));
      attempts.push(...(result.attempts ?? [{ output: result.value, metadata: result.metadata }]));
      citations.push(...(result.metadata.citations ?? []));
      return result;
    } catch (error) {
      if (error instanceof LlmProviderError) {
        error.attempts = [
          ...attempts,
          ...error.attempts.map((attempt) => ({ ...attempt, metadata: metadata(attempt.metadata) })),
        ];
        if (error.attemptMetadata) error.attemptMetadata = metadata(error.attemptMetadata);
      }
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
  const operation = includeCustomization ? "customization_delta" : "character_understanding";
  async function afterCompletedLlm<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      carryCompletedLlmGroups(error, [{ operation, inputHash, attempts: [...attempts] }]);
      throw error;
    }
  }
  async function normalize(audit: Parameters<NormalizeUnderstandingAudit>[0], completionAttempted: boolean) {
    try {
      return await normalizeAudit(audit, citations, completionAttempted);
    } catch (cause) {
      // Provenance reads can fail after successful LLM calls. Keep their records for the failure commit.
      const error = new LlmProviderError(
        "キャラクター像の根拠検証に失敗しました",
        analysisErrorCode(cause),
        isRetryableFailure(cause),
        safeAnalysisErrorDetail(cause),
      );
      error.operation = includeCustomization ? "customization_delta" : "character_understanding";
      error.attempts = [...attempts];
      throw error;
    }
  }
  let current = result;
  let completionAttempted = false;
  let judged = await afterCompletedLlm(() =>
    judgeUnderstandingCandidate(env, {
      candidate: current.value,
      payload: entry.payload,
      ontology,
      research,
      correlationId: entry.entryRevisionId,
      stage,
      domain: entry.analysisDomain,
      registeredCharacter: analysisTargetName,
    }),
  );
  let normalized = await afterCompletedLlm(() => normalize(judged.audit, completionAttempted));
  let issues = [...judged.issues, ...understandingQualityIssues(normalized), ...normalized.informationQuality.reasons];
  for (
    let round = 1;
    normalized.informationQuality.concreteAspectCount < 2 && round <= MAX_ANALYSIS_RECONSIDERATION_ROUNDS;
    round++
  ) {
    completionAttempted = true;
    const missingAspects = understandingAspects
      .filter((aspect) => normalized.informationQuality.aspects[aspect].kind !== "concrete")
      .map((aspect) => ({ aspect, label: understandingAspectLabels[aspect] }));
    const retainedCandidate = {
      summary: Object.fromEntries(
        understandingAspects.flatMap((aspect) =>
          normalized.summary[aspect].some((text) => text.trim()) ? [[aspect, normalized.summary[aspect]]] : [],
        ),
      ),
      assertions: normalized.assertions,
      customizationDeltas: normalized.customizationDeltas,
    };
    const availableSources = {
      inputPointers: allowedInputPointers,
      publicSources: research.sources.map(({ title, url, provider, trustReason }) => ({
        title,
        url,
        provider,
        trustReason,
      })),
      citedUrls: [...new Set(citations.map((citation) => citation.url))],
    };
    current = await recordCall({
      operation: includeCustomization ? "customization_delta" : "character_understanding",
      schemaName: "character_understanding_candidate",
      schemaVersion: "1.0",
      schema: understandingCandidateSchema,
      jsonSchema: z.toJSONSchema(understandingCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
      messages: [
        ...messages,
        {
          role: "user",
          content: `${UNDERSTANDING_COMPLETION_INSTRUCTION}\n再検討回数: ${round}/${MAX_ANALYSIS_RECONSIDERATION_ROUNDS}\n欠落項目: ${JSON.stringify(missingAspects)}\n保持済み候補: ${JSON.stringify(retainedCandidate)}\n利用可能な出典: ${JSON.stringify(availableSources)}`,
        },
      ],
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      temperature: 0,
      idempotencyKey: `${entry.entryRevisionId}:${stage}:complete:${round}`,
      safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
      enableWebSearch:
        entry.payload.registrationType === "existing" ||
        (entry.payload.registrationType === "customized_existing" && stage === "base"),
      fakeFactory: () => current.value,
    });
    judged = await afterCompletedLlm(() =>
      judgeUnderstandingCandidate(env, {
        candidate: current.value,
        payload: entry.payload,
        ontology,
        research,
        correlationId: entry.entryRevisionId,
        stage: `${stage}:reconsider:${round}`,
        domain: entry.analysisDomain,
        registeredCharacter: analysisTargetName,
      }),
    );
    normalized = await afterCompletedLlm(() => normalize(judged.audit, completionAttempted));
    issues = [...judged.issues, ...understandingQualityIssues(normalized), ...normalized.informationQuality.reasons];
  }
  if (issues.length) {
    normalized = {
      ...normalized,
      uncertainties: [
        ...normalized.uncertainties,
        ...issues.map((reason) => ({
          topic: analysisIssueTopic(reason),
          reason: analysisIssueText(reason).slice(0, 2_000),
        })),
      ].slice(-50),
      sourceAssessment: {
        ...normalized.sourceAssessment,
        coverage:
          normalized.sourceAssessment.coverage === "sufficient" ? "partial" : normalized.sourceAssessment.coverage,
        limitations: [...new Set([...normalized.sourceAssessment.limitations, ...issues.map(analysisIssueText)])].slice(
          -50,
        ),
      },
    };
  }
  const value = {
    ...understandingCandidateSchema.parse(normalized),
    sourceAssessment: {
      ...normalized.sourceAssessment,
      informationQuality: normalized.informationQuality,
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
    ...current,
    metadata: {
      ...current.metadata,
      citations,
    },
    attempts,
    value,
    inputHash,
    representationId,
    semanticAudit: judged.audit,
  };
}
