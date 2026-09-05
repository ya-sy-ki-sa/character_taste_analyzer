import { z } from "zod";
import {
  type DarkTransformationDelta,
  type DarkUnderstandingCandidate,
  darkTransformationDeltaSchema,
} from "../../../shared/contracts/dark-understanding";
import type { EntryDraft } from "../../../shared/contracts/entries";
import {
  type AnyPreferenceCandidate,
  type PreferenceCandidate,
  preferenceCandidateSchema,
} from "../../../shared/contracts/preference";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import { entryInputSources, entryPreferenceContext, entryScopeText } from "../../../shared/entry-input";
import { responseChannelPrompt } from "../../../shared/response-channels";
import { hmacHex, normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import { createJobLlmProvider } from "../../llm/execution";
import { SYSTEM_INSTRUCTION } from "../../llm/prompts/analysis";
import type { LlmRunMetadata } from "../../llm/types";
import { loadInputProvenanceSources, verifyEvidenceReference } from "../../platform/provenance/sources";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import { claimJob, finishJobAttempt, isRetryableFailure, type JobClaim } from "../jobs/execution";
import { analysisFenceIsCurrent, supersedeAnalysisClaim } from "./claims";
import { loadConfirmedUnderstanding } from "./confirmed-understanding";
import { loadEntry, loadOntology, ontologyPrompt } from "./context";
import { fakePreferences, refinedFakePreferences } from "./deterministic";
import { analysisErrorCode, analysisFailureMetadata, safeAnalysisErrorDetail, updateFailure } from "./failures";
import { commitHypothesisPreview, generatePreferenceHypotheses } from "./hypotheses";
import { refinementInstruction } from "./input";
import { analyzeDarkPreferences, auditDarkPreferences } from "./llm-dark";
import {
  completedLlmGroup,
  persistCompletedLlmGroupsOnFailure,
  persistFailedModelRuns,
  persistModelRun,
} from "./model-runs";
import * as repository from "./repositories/preference";
import {
  loadRetainedPreferences,
  mergeRetainedPreferences,
  mergeSelectedPreferenceHypotheses,
  retainPreferenceStatements,
} from "./retention";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { CompletedLlmGroup } from "./types";
import { rebuildConfirmedUnderstandingSummary } from "./understanding-summary";

export async function processPreferenceAnalysis(env: Env, params: CharacterAnalysisWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  const completedLlmGroups: CompletedLlmGroup[] = [];
  try {
    const latestRefinement = await first<{ id: string }>(
      repository.selectPreferenceRefinements(env.DB, [params.ownerUserId, params.entryId, params.analysisDomain]),
    );
    if ((latestRefinement?.id ?? null) !== (params.refinementId ?? null)) return;
    claim = await claimJob(
      env,
      params.jobId,
      params.ownerUserId,
      params.inputGeneration,
      params.refinementId ? `preferenceAnalysis:${params.refinementId}` : "preferenceAnalysis",
    );
    if (claim.status === "attempts_exhausted") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    if (claim.status !== "claimed") return;
    const entry = await loadEntry(
      env,
      params.ownerUserId,
      params.analysisDomain,
      params.entryId,
      await createJobLlmProvider(env, params.jobId, params.ownerUserId),
    );
    if (params.refinementId) {
      const refinement = await first<{
        id: string;
        mode: "questions" | "hypotheses";
        answers_json: string;
        context_json: string;
      }>(
        repository.selectPreferenceRefinements2(env.DB, [
          params.refinementId,
          params.ownerUserId,
          entry.entryRevisionId,
        ]),
      );
      if (!refinement) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
      entry.refinement = {
        id: refinement.id,
        mode: refinement.mode,
        answers: JSON.parse(refinement.answers_json),
        context: JSON.parse(refinement.context_json),
      };
    }
    const snapshot = await first<{
      id: string;
      summary_json: string;
      source_assessment_json: string;
      uncertainties_json: string;
    }>(
      repository.selectCharacterUnderstandingSnapshots(env.DB, [
        params.ownerUserId,
        entry.entryRevisionId,
        entry.representationId,
      ]),
    );
    if (!snapshot) throw new Error("CONFIRMED_UNDERSTANDING_REQUIRED");
    const ontology = await loadOntology(env, params.analysisDomain);
    const previousReviews = await all<Record<string, unknown>>(
      repository.selectPreferenceAssertions(env.DB, [params.ownerUserId, entry.entryRevisionId]),
    );

    entry.preferenceReviewHistory = previousReviews;
    const provenanceSources = await loadInputProvenanceSources(env, entry.sourceSetId);
    const allowedUrls = new Set(provenanceSources.flatMap((source) => (source.url ? [source.url] : [])));
    const confirmed = await loadConfirmedUnderstanding(env, params.ownerUserId, snapshot.id);
    entry.reviewExclusions = confirmed.excluded;
    const characterAssertions = confirmed.rows;
    const parsedSummary = JSON.parse(snapshot.summary_json) as UnderstandingCandidate["summary"] & {
      darkState?: DarkUnderstandingCandidate["darkState"];
      auditNotes?: string[];
    };
    const confirmedSummary = rebuildConfirmedUnderstandingSummary(parsedSummary, characterAssertions);
    const understanding: UnderstandingCandidate = {
      sourceAssessment: JSON.parse(snapshot.source_assessment_json),
      summary: { ...confirmedSummary, identity: entry.payload.characterName },
      assertions: confirmed.assertions,
      customizationDeltas: confirmed.customizationDeltas,
      uncertainties: JSON.parse(snapshot.uncertainties_json),
    };
    const retained = await loadRetainedPreferences(
      env,
      params.ownerUserId,
      entry.refinement?.context?.baseAnalysisRunId,
    );
    entry.retainedPreferences = retained.preferences;
    if (entry.refinement?.mode === "hypotheses" && entry.refinement.context?.baseAnalysisRunId) {
      const preview = await generatePreferenceHypotheses(
        env,
        entry.llm,
        params.ownerUserId,
        params.analysisDomain,
        entry.refinement.id,
        entry.entryRevisionId,
        entry.payload,
        understanding,
        ontology,
        retained,
        { previousReviews, understanding: entry.reviewExclusions },
      );
      completedLlmGroups.push(completedLlmGroup("preference_hypotheses", preview.inputHash, preview));
      const metadata = [];
      for (const attempt of preview.attempts ?? [{ output: preview.value, metadata: preview.metadata }]) {
        const run = await persistModelRun(
          env,
          params.ownerUserId,
          "preference_hypotheses",
          preview.inputHash,
          attempt.output,
          attempt.metadata,
          params.analysisDomain,
        );
        metadata.push(run.statement);
      }
      await commitHypothesisPreview(
        env,
        params,
        claim.attemptId,
        entry.refinement.context.baseAnalysisRunId,
        preview.candidates,
        metadata,
      );
      return;
    }
    const generation = await first<{ next_generation: number }>(
      repository.selectAnalysisRuns(env.DB, [params.ownerUserId, entry.entryRevisionId]),
    );
    if (!generation) throw new Error("ANALYSIS_GENERATION_UNAVAILABLE");
    const runGeneration = generation.next_generation;
    const messages = [
      { role: "system" as const, content: SYSTEM_INSTRUCTION },
      {
        role: "user" as const,
        content: `確認済みキャラクター理解とユーザーの好きな理由を分け、嗜好候補を抽出してください。キャラクターが持つ全属性を自動で好きにしないでください。ヴィラン性や悪そのものへの好意を悲劇性や知性に言い換えないでください。ユーザーが選択したresponse channelは、その定義どおりに優先して使ってください。根拠不足なら候補0件を正常な結果として返し、uncertaintiesに追加で尋ねる具体的な質問を最大3件書いてください。反応経路の選択だけから対象属性への好意を推定しないでください。未選択のchannelを推測する場合は、好きな理由に十分な根拠があるものだけに限定してください。\n以前の好みの訂正・削除（correctedは訂正後の内容を尊重し、rejectedとsupersededは復活させない）: ${JSON.stringify(previousReviews)}\n理解: ${JSON.stringify(understanding)}\n嗜好入力: ${JSON.stringify(entry.payload.preference)}\n以前の好みの確認記録（correctedを尊重しrejected/supersededを復活させない）: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え（復活させない）: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n入力根拠に使用できるJSON Pointer: ${JSON.stringify(
          entryInputSources(entry.payload)
            .filter((source) => source.pointer.startsWith("/preference/"))
            .map((source) => source.pointer),
        )}\nresponse channel定義:\n${responseChannelPrompt()}\n統制属性:\n${ontologyPrompt(ontology)}`,
      },
    ];
    let result: {
      value: AnyPreferenceCandidate;
      metadata: LlmRunMetadata;
      attempts?: Array<{ output: unknown; metadata: LlmRunMetadata }>;
    };
    let inputHash: string;
    let preferenceOperation: "preference_analysis" | "preference_audit" | "dark_preference_audit";
    if (params.analysisDomain === "dark") {
      const persistedDeltas = await all<{
        operation: DarkTransformationDelta["operation"];
        aspect: string;
        before_value: string | null;
        after_value: string | null;
        detail_json: string;
        confidence: number;
      }>(repository.selectDarkTransformationDeltas(env.DB, [params.ownerUserId, snapshot.id]));
      const transformationDeltas = persistedDeltas.map((row) => {
        const detail = JSON.parse(row.detail_json) as Omit<
          DarkTransformationDelta,
          "operation" | "aspect" | "beforeValue" | "afterValue" | "confidence"
        >;
        return darkTransformationDeltaSchema.parse({
          ...detail,
          operation: row.operation,
          aspect: row.aspect,
          beforeValue: row.before_value,
          afterValue: row.after_value,
          confidence: row.confidence,
        });
      });
      const darkUnderstanding: DarkUnderstandingCandidate = {
        ...understanding,
        darkState: parsedSummary.darkState ?? {
          agencyOrigin: "unclear",
          consent: "unknown",
          awareness: "unknown",
          resistance: "unknown",
          identityContinuity: "unknown",
          responsibility: "unknown",
          reversibility: "unknown",
          controllerOrInfluence: null,
          mechanism: null,
          before: null,
          onset: null,
          activeState: entryScopeText(entry.payload),
          recoveryOrAfter: null,
        },
        transformationDeltas,
        auditNotes: parsedSummary.auditNotes ?? [],
      };
      const initial = await analyzeDarkPreferences(env, entry, darkUnderstanding, ontology, runGeneration);
      completedLlmGroups.push(completedLlmGroup("dark_preference_analysis", initial.inputHash, initial));
      const audited = await auditDarkPreferences(env, entry, initial.value, ontology, runGeneration, darkUnderstanding);
      completedLlmGroups.push(completedLlmGroup("dark_preference_audit", audited.inputHash, audited));
      result = audited;
      inputHash = audited.inputHash;
      preferenceOperation = "dark_preference_audit";
    } else {
      inputHash = await sha256Hex(JSON.stringify(messages));
      const standardPayload = entry.payload as EntryDraft;
      result = await entry.llm.generateStructured({
        operation: "preference_analysis",
        schemaName: "preference_analysis_candidate",
        schemaVersion: "1.0",
        schema: preferenceCandidateSchema,
        jsonSchema: z.toJSONSchema(preferenceCandidateSchema, {
          target: "draft-7",
        }) as Record<string, unknown>,
        messages,
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature: 0.1,
        idempotencyKey: `${entry.entryRevisionId}:preference:${runGeneration}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        fakeFactory: () =>
          refinedFakePreferences(entry, fakePreferences(standardPayload, understanding), understanding),
      });
      completedLlmGroups.push(completedLlmGroup("preference_analysis", inputHash, result));
      const initial = result.value as PreferenceCandidate;
      const auditMessages = [
        { role: "system" as const, content: SYSTEM_INSTRUCTION },
        {
          role: "user" as const,
          content: `嗜好候補を独立監査し完全な改訂結果を返してください。訂正済み理解が優先で、削除済み特徴を原資料から復活させないでください。入力に支持されない推定、好意と道徳的支持の混同、条件や反応経路の拡大を除去します。好きな理由と苦手な理由をそれぞれ照合し、明示的な苦手条件を、人物にその設定がないという理由だけで削除しないでください。肯定・否定が別の条件なら別候補で保持してください。候補0件は正常です。推測をuser_explicitへ格上げせず、根拠やURLを捏造しないでください。\n${JSON.stringify(
            {
              candidate: initial,
              confirmedUnderstanding: understanding,
              reviewExclusions: entry.reviewExclusions,
              input: entry.payload,
              refinement: entry.refinement,
              refinementInstruction: refinementInstruction(entry),
              previousReviews,
              sources: provenanceSources,
              ontology,
            },
          )}`,
        },
      ];
      inputHash = await sha256Hex(JSON.stringify(auditMessages));
      result = await entry.llm.generateStructured({
        operation: "preference_audit",
        schemaName: "preference_analysis_candidate",
        schemaVersion: "2.0",
        schema: preferenceCandidateSchema,
        jsonSchema: z.toJSONSchema(preferenceCandidateSchema, { target: "draft-7" }) as Record<string, unknown>,
        messages: auditMessages,
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        idempotencyKey: `${entry.entryRevisionId}:preference-audit:${runGeneration}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        fakeFactory: () => initial,
      });
      completedLlmGroups.push(completedLlmGroup("preference_audit", inputHash, result));
      preferenceOperation = "preference_audit";
    }
    if (entry.refinement?.mode === "hypotheses") {
      for (const item of result.value.preferenceAssertions) {
        item.explicitness = "inferred";
        item.confidence = Math.min(item.confidence, 0.35);
      }
      for (const item of result.value.valueStanceAssertions) {
        item.explicitness = "inferred";
        item.confidence = Math.min(item.confidence, 0.35);
      }
    }
    const selected = entry.refinement?.context?.selectedHypotheses ?? [];
    if (entry.refinement && selected.length)
      mergeSelectedPreferenceHypotheses(
        result.value,
        selected,
        entry.refinement.id,
        entryPreferenceContext(entry.payload) ?? null,
      );
    if (entry.refinement?.context?.baseAnalysisRunId) mergeRetainedPreferences(result.value, retained);
    await persistCompletedLlmGroupsOnFailure(env, params.ownerUserId, completedLlmGroups.slice(0, -1));
    const attemptRuns = [];
    for (const attempt of result.attempts ?? [{ output: result.value, metadata: result.metadata }])
      attemptRuns.push(
        await persistModelRun(
          env,
          params.ownerUserId,
          preferenceOperation,
          inputHash,
          attempt.output,
          attempt.metadata,
          params.analysisDomain,
        ),
      );
    const modelRun = attemptRuns.at(-1);
    if (!modelRun) throw new Error("MODEL_RUN_MISSING");
    const runId = crypto.randomUUID();
    const now = nowIso();
    const commitStep = `commit-preference:${claim.attemptId}`;
    const commitGuard = repository.updateJobs(env.DB, [
      commitStep,
      now,
      params.jobId,
      params.ownerUserId,
      params.inputGeneration,
      params.entryId,
      params.ownerUserId,
      params.inputGeneration,
      claim.attemptId,
    ]);
    const statements: D1PreparedStatement[] = [commitGuard, ...attemptRuns.map((item) => item.statement)];
    statements.push(
      repository.insertAnalysisRuns(env.DB, [
        runId,
        params.ownerUserId,
        entry.entryRevisionId,
        snapshot.id,
        runGeneration,
        modelRun.id,
        params.analysisDomain === "dark" ? "dark-1.0" : "1.0",
        JSON.stringify(result.value.summary),
        JSON.stringify(result.value.uncertainties),
        now,
        now,
        now,
        params.jobId,
        params.ownerUserId,
        commitStep,
      ]),
    );
    statements.push(
      repository.updateAnalysisRuns(env.DB, [
        JSON.stringify({
          schemaVersion: "2.1",
          refinementMode: selected.length ? "selection" : (entry.refinement?.mode ?? null),
          retainedFromAnalysisRunId: entry.refinement?.context?.baseAnalysisRunId ?? null,
          confirmedUnderstandingSnapshotId: snapshot.id,
          audit: preferenceOperation,
          evidenceInsufficient:
            result.value.preferenceAssertions.length === 0 &&
            result.value.valueStanceAssertions.length === 0 &&
            retained.preferences.length === 0 &&
            retained.stances.length === 0,
        }),
        runId,
      ]),
    );
    statements.push(...(await retainPreferenceStatements(env, params.ownerUserId, runId, retained)));
    const attributeByKey = new Map(ontology.map((item) => [item.stable_key, item]));
    const preferenceIds: string[] = [];
    for (const assertion of result.value.preferenceAssertions) {
      const id = crypto.randomUUID();
      preferenceIds.push(id);
      const rawId = crypto.randomUUID();
      const attribute = assertion.attributeStableKey ? attributeByKey.get(assertion.attributeStableKey) : undefined;
      statements.push(
        repository.insertRawAttributeMentions(env.DB, [
          rawId,
          params.ownerUserId,
          id,
          assertion.rawLabel,
          normalizeIdentityPart(assertion.rawLabel),
          now,
        ]),
      );
      statements.push(
        repository.insertAttributeMappings(env.DB, [
          crypto.randomUUID(),
          rawId,
          attribute?.id ?? null,
          attribute ? "accepted" : "unmapped",
          attribute ? "exact" : "llm",
          attribute ? 1 : assertion.confidence,
          now,
          attribute ? now : null,
        ]),
      );
      statements.push(
        repository.insertPreferenceAssertions(env.DB, [
          id,
          params.ownerUserId,
          runId,
          entry.entryRevisionId,
          entry.characterIdentityId,
          entry.representationId,
          attribute?.id ?? null,
          rawId,
          params.analysisDomain,
          assertion.polarity,
          assertion.responseChannel,
          assertion.strength,
          assertion.explicitness,
          assertion.explicitness === "model_knowledge" ? Math.min(0.45, assertion.confidence) : assertion.confidence,
          JSON.stringify(assertion.context),
          now,
        ]),
      );
      for (const evidence of assertion.evidence) {
        const verified = await verifyEvidenceReference(evidence, provenanceSources, allowedUrls);
        statements.push(
          repository.insertEvidenceFragments(env.DB, [
            crypto.randomUUID(),
            params.ownerUserId,
            id,
            verified.sourceId,
            verified.evidenceOrigin,
            verified.quoteStart,
            verified.quoteEnd,
            verified.quoteHash,
            verified.excerptText,
            verified.inputPointer,
            assertion.confidence,
            verified.verificationStatus,
            verified.inferenceType,
            now,
          ]),
        );
      }
    }
    for (const stance of result.value.valueStanceAssertions) {
      const id = crypto.randomUUID();
      statements.push(
        repository.insertValueStanceAssertions(env.DB, [
          id,
          params.ownerUserId,
          runId,
          stance.targetType,
          stance.targetRef,
          stance.stance,
          stance.orientation,
          JSON.stringify(stance.context),
          stance.explicitness,
          stance.confidence,
          now,
        ]),
      );
      for (const evidence of stance.evidence) {
        const verified = await verifyEvidenceReference(evidence, provenanceSources, allowedUrls);
        statements.push(
          repository.insertEvidenceFragments2(env.DB, [
            crypto.randomUUID(),
            params.ownerUserId,
            id,
            verified.sourceId,
            verified.evidenceOrigin,
            verified.quoteStart,
            verified.quoteEnd,
            verified.quoteHash,
            verified.excerptText,
            verified.inputPointer,
            stance.confidence,
            verified.verificationStatus,
            verified.inferenceType,
            now,
          ]),
        );
      }
    }
    statements.push(
      repository.updateUserCharacterEntries(env.DB, [
        now,
        params.entryId,
        params.ownerUserId,
        params.inputGeneration,
        params.jobId,
        commitStep,
      ]),
    );
    statements.push(
      repository.updateJobs2(env.DB, [
        JSON.stringify({ entryId: params.entryId, reviewTargetId: runId }),
        now,
        params.jobId,
        params.ownerUserId,
        params.inputGeneration,
        commitStep,
      ]),
    );
    statements.push(repository.updateJobAttempts(env.DB, [now, claim.attemptId, params.jobId]));
    const results = await env.DB.batch(statements);
    if (results.some((item) => !item.success)) throw new Error("D1_BATCH_FAILED");
    if (
      !results[0].meta.changes ||
      !results.at(-3)?.meta.changes ||
      !results.at(-2)?.meta.changes ||
      !results.at(-1)?.meta.changes
    )
      throw new Error("JOB_COMMIT_FENCE_CHANGED");
  } catch (error) {
    if (claim?.status === "claimed" && !(await analysisFenceIsCurrent(env, params, claim.attemptId))) {
      await supersedeAnalysisClaim(env, params, claim.attemptId);
      return;
    }
    await persistCompletedLlmGroupsOnFailure(env, params.ownerUserId, completedLlmGroups);
    await persistFailedModelRuns(env, params.ownerUserId, error);
    const latestMetadata = analysisFailureMetadata(error, completedLlmGroups.at(-1)?.attempts.at(-1)?.metadata);
    const willRetry = claim?.status === "claimed" && claim.stepAttemptNumber < 3 && isRetryableFailure(error);
    if (claim?.status === "claimed")
      await finishJobAttempt(
        env,
        claim.attemptId,
        "failed",
        analysisErrorCode(error),
        safeAnalysisErrorDetail(error, latestMetadata)?.slice(0, 2_000) ?? null,
      );
    await updateFailure(env, params, error, willRetry, latestMetadata);
    if (willRetry) throw error;
  }
}
