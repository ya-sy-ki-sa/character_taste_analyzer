import { z } from "zod";
import type { CitationIssue } from "../../../shared/contracts/citations";
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
import { type GroundedPreferenceAudit, groundedPreferenceAuditSchema } from "../../../shared/contracts/semantic-audit";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import { entryInputSources, entryPreferenceContext, entryScopeText } from "../../../shared/entry-input";
import { responseChannelPrompt } from "../../../shared/response-channels";
import { hmacHex, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import { createJobLlmProvider } from "../../llm/execution";
import { PREFERENCE_PROMPT_VERSION, PREFERENCE_SCHEMA_VERSION, preferenceSystem } from "../../llm/prompts/preference";
import { SEMANTIC_AUDIT_POLICY, SEMANTIC_AUDIT_SCHEMA_VERSION } from "../../llm/prompts/semantic-audit";
import type { LlmRunMetadata } from "../../llm/types";
import { CITATION_POLICY_VERSION, CitationRegistry } from "../../platform/provenance/registry";
import { loadInputProvenanceSources } from "../../platform/provenance/sources";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import { claimJob, type JobClaim } from "../jobs/execution";
import { handleAnalysisAttemptFailure } from "./attempt-failure";
import { citationAwareProvider, logCitationIssues, verifyAssertionEvidence } from "./citations";
import { loadConfirmedUnderstanding } from "./confirmed-understanding";
import { loadEntry, loadOntology, ontologyPrompt } from "./context";
import { fakePreferences, refinedFakePreferences } from "./deterministic";
import { commitHypothesisPreview, generatePreferenceHypotheses } from "./hypotheses";
import { refinementInstruction } from "./input";
import { analyzeDarkPreferences, auditDarkPreferences } from "./llm-dark";
import { completedLlmGroup, persistCompletedLlmGroupsOnFailure, persistModelRun } from "./model-runs";
import { preferenceAssertionStatements } from "./preference-statements";
import * as repository from "./repositories/preference";
import {
  loadRetainedPreferences,
  mergeRetainedPreferences,
  mergeSelectedPreferenceHypotheses,
  retainPreferenceStatements,
} from "./retention";
import { fakeGroundedPreferences } from "./semantic-fake";
import { verifySemanticAssertion } from "./semantic-integrity";
import { ANALYSIS_MAX_OUTPUT_TOKENS } from "./settings";
import type { CompletedLlmGroup } from "./types";
import { rebuildConfirmedUnderstandingSummary } from "./understanding-summary";

export async function processPreferenceAnalysis(env: Env, params: CharacterAnalysisWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  const completedLlmGroups: CompletedLlmGroup[] = [];
  try {
    const latestRefinement = await first<{ id: string }>(
      repository.selectLatestRefinement(env.DB, [params.ownerUserId, params.entryId, params.analysisDomain]),
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
      }>(repository.selectRevisionRefinement(env.DB, [params.refinementId, params.ownerUserId, entry.entryRevisionId]));
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
    const externalSources = [...allowedUrls].map((url) => ({ url, title: url }));
    const citationRegistry = new CitationRegistry();
    await citationRegistry.add(externalSources);
    const confirmed = await loadConfirmedUnderstanding(env, params.ownerUserId, snapshot.id);
    entry.reviewExclusions = confirmed.excluded;
    const characterAssertions = confirmed.rows;
    const parsedSummary = JSON.parse(snapshot.summary_json) as UnderstandingCandidate["summary"] & {
      darkState?: DarkUnderstandingCandidate["darkState"];
      auditNotes?: string[];
    };
    const confirmedSummary = rebuildConfirmedUnderstandingSummary(parsedSummary, characterAssertions);
    const understanding: UnderstandingCandidate = {
      sourceAssessment: (({ informationQuality: _quality, semanticAudit: _audit, ...assessment }) => assessment)(
        JSON.parse(snapshot.source_assessment_json),
      ),
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
    if (entry.refinement?.mode === "hypotheses") {
      if (!entry.refinement.context?.baseAnalysisRunId) throw new Error("HYPOTHESIS_BASE_ANALYSIS_REQUIRED");
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
    // Hypotheses have no evidence fields; only extraction/audit needs the citation ledger instructions.
    entry.llm = await citationAwareProvider(entry.llm, externalSources);
    const generation = await first<{ next_generation: number }>(
      repository.selectAnalysisRuns(env.DB, [params.ownerUserId, entry.entryRevisionId]),
    );
    if (!generation) throw new Error("ANALYSIS_GENERATION_UNAVAILABLE");
    const runGeneration = generation.next_generation;
    const messages = [
      { role: "system" as const, content: preferenceSystem("standard", "extract") },
      {
        role: "user" as const,
        content: `理解: ${JSON.stringify(understanding)}\n嗜好入力: ${JSON.stringify(entry.payload.preference)}\n以前の好みの確認記録: ${JSON.stringify(entry.preferenceReviewHistory ?? [])}\n人物理解からの削除・差し替え: ${JSON.stringify(entry.reviewExclusions ?? [])}\n追加入力: ${JSON.stringify(entry.refinement ?? null)}\n${refinementInstruction(entry)}\n入力根拠に使用できるJSON Pointer: ${JSON.stringify(
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
        schemaVersion: PREFERENCE_SCHEMA_VERSION,
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
        { role: "system" as const, content: preferenceSystem("standard", "audit") },
        {
          role: "user" as const,
          content: `${JSON.stringify({
            candidate: initial,
            confirmedUnderstanding: understanding,
            reviewExclusions: entry.reviewExclusions,
            input: entry.payload,
            refinement: entry.refinement,
            refinementInstruction: refinementInstruction(entry),
            previousReviews,
            sources: provenanceSources,
            ontology,
          })}`,
        },
      ];
      inputHash = await sha256Hex(JSON.stringify(auditMessages));
      result = await entry.llm.generateStructured({
        operation: "preference_audit",
        schemaName: "preference_grounded_audit",
        schemaVersion: SEMANTIC_AUDIT_SCHEMA_VERSION,
        schema: groundedPreferenceAuditSchema,
        jsonSchema: z.toJSONSchema(groundedPreferenceAuditSchema, { target: "draft-7" }) as Record<string, unknown>,
        messages: auditMessages,
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        idempotencyKey: `${entry.entryRevisionId}:preference-audit:${runGeneration}`,
        safetyIdentifier: await hmacHex(env.AUTH_PEPPER, `openai-safety:${entry.ownerUserId}`),
        fakeFactory: () => fakeGroundedPreferences(initial),
      });
      const annotateAudit = (metadata: LlmRunMetadata) => ({
        ...metadata,
        effectiveSettings: {
          ...metadata.effectiveSettings,
          semanticAuditPolicy: SEMANTIC_AUDIT_POLICY,
          actualSchemaName: "preference_grounded_audit",
          actualSchemaVersion: SEMANTIC_AUDIT_SCHEMA_VERSION,
        },
      });
      result.metadata = annotateAudit(result.metadata);
      if (result.attempts)
        result.attempts = result.attempts.map((attempt) => ({ ...attempt, metadata: annotateAudit(attempt.metadata) }));
      completedLlmGroups.push(completedLlmGroup("preference_audit", inputHash, result));
      preferenceOperation = "preference_audit";
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
    const modelRunId = modelRun.id;
    const citationIssues: CitationIssue[] = [];
    async function verifyCandidates(
      items: Array<{ evidence: import("../../../shared/contracts/evidence").EvidenceReference[]; confidence: number }>,
      targetType: CitationIssue["targetType"],
    ) {
      return Promise.all(
        items.map(async (assertion) => {
          const id = crypto.randomUUID();
          const target = { targetType, targetId: id, modelRunId };
          if (params.analysisDomain === "standard" && "scopeAssessment" in assertion) {
            return {
              id,
              ...(await verifySemanticAssertion(
                assertion as GroundedPreferenceAudit["preferenceAssertions"][number],
                provenanceSources,
                allowedUrls,
                citationRegistry,
                target,
                citationIssues,
              )),
            };
          }
          // Explicitly selected refinement hypotheses and the unchanged dark pipeline use their own provenance policy.
          const verified = await verifyAssertionEvidence(
            assertion,
            provenanceSources,
            allowedUrls,
            citationRegistry,
            target,
            citationIssues,
          );
          return { id, ...verified, keep: true, explicitness: null, audit: null };
        }),
      );
    }
    let verifiedPreferences = await verifyCandidates(result.value.preferenceAssertions, "preference_assertion");
    let verifiedStances = await verifyCandidates(result.value.valueStanceAssertions, "value_stance_assertion");
    // Keep provider outputs unchanged for the run hash.
    result = { ...result, value: structuredClone(result.value) };
    const semanticAudit = [...verifiedPreferences, ...verifiedStances].flatMap((item) =>
      item.audit ? [item.audit] : [],
    );
    const rejected = [
      ...result.value.preferenceAssertions.flatMap((item, index) =>
        verifiedPreferences[index].keep
          ? []
          : [{ label: item.rawLabel, reason: verifiedPreferences[index].audit?.reason }],
      ),
      ...result.value.valueStanceAssertions.flatMap((item, index) =>
        verifiedStances[index].keep ? [] : [{ label: item.targetRef, reason: verifiedStances[index].audit?.reason }],
      ),
    ];
    result.value.preferenceAssertions = result.value.preferenceAssertions.flatMap((item, index) => {
      const proof = verifiedPreferences[index];
      return proof.keep
        ? [
            {
              ...item,
              confidence: proof.confidence,
              explicitness: (proof.explicitness ?? item.explicitness) as typeof item.explicitness,
            },
          ]
        : [];
    }) as typeof result.value.preferenceAssertions;
    result.value.valueStanceAssertions = result.value.valueStanceAssertions.flatMap((item, index) => {
      const proof = verifiedStances[index];
      return proof.keep
        ? [
            {
              ...item,
              confidence: proof.confidence,
              explicitness: (proof.explicitness ?? item.explicitness) as typeof item.explicitness,
            },
          ]
        : [];
    });
    verifiedPreferences = verifiedPreferences.filter((item) => item.keep);
    verifiedStances = verifiedStances.filter((item) => item.keep);
    if (params.analysisDomain === "standard") {
      // Strip internal audit fields from the public candidate contract after recording them above.
      result.value = preferenceCandidateSchema.parse(result.value);
      if (rejected.length) {
        result.value.summary = {
          userExplicitSummary: [
            ...new Set([
              ...retained.summary.userExplicitSummary,
              entry.payload.preference.likedReasons?.slice(0, 1_000) ?? "",
              ...(entry.payload.preference.dislikedReasons
                ? [entry.payload.preference.dislikedReasons.slice(0, 1_000)]
                : []),
              ...result.value.preferenceAssertions
                .filter((item) => ["user_explicit", "user_confirmed"].includes(item.explicitness))
                .map((item) => item.rawLabel),
            ]),
          ]
            .filter(Boolean)
            .slice(0, 50),
          inferredSummary: [
            ...retained.summary.inferredSummary,
            ...result.value.preferenceAssertions
              .filter((item) => item.explicitness === "inferred")
              .map((item) => item.rawLabel),
          ].slice(0, 50),
          limitations: [
            ...result.value.summary.limitations,
            ...rejected.map((item) => `${item.label}：${item.reason}`),
          ].slice(-50),
        };
        result.value.uncertainties = [
          ...result.value.uncertainties,
          ...rejected.map((item) => ({
            topic: item.label.slice(0, 500),
            reason: item.reason ?? "対象または意味的な根拠を確認できません。",
            recommendedQuestion: `「${item.label.slice(0, 200)}」について、誰のどの行動・関係・条件への好みですか？`,
          })),
        ].slice(-50);
      }
    }
    logCitationIssues(modelRun.id, citationIssues);
    const runId = crypto.randomUUID();
    const now = nowIso();
    const commitStep = `commit-preference:${claim.attemptId}`;
    const commitGuard = repository.acquirePreferenceCommitFence(env.DB, [
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
          schemaVersion: "2.3",
          ...(params.analysisDomain === "standard"
            ? { semanticAudit: { policyVersion: SEMANTIC_AUDIT_POLICY, assertions: semanticAudit } }
            : {}),
          preferencePromptVersion: PREFERENCE_PROMPT_VERSION,
          preferenceAssertionCount: result.value.preferenceAssertions.length + retained.preferences.length,
          valueStanceAssertionCount: result.value.valueStanceAssertions.length + retained.stances.length,
          unresolvedResponseChannelCount:
            result.value.preferenceAssertions.filter((item) => item.responseChannel === null).length +
            retained.preferences.filter((item) => item.response_channel === null).length,
          citationIssues,
          citationPolicyVersion: CITATION_POLICY_VERSION,
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
    statements.push(
      ...preferenceAssertionStatements(env.DB, {
        ownerUserId: params.ownerUserId,
        analysisDomain: params.analysisDomain,
        entry,
        runId,
        value: result.value,
        verifiedPreferences,
        verifiedStances,
        ontology,
        now,
      }),
    );
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
      repository.awaitPreferenceReview(env.DB, [
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
    await handleAnalysisAttemptFailure(env, params, claim, completedLlmGroups, error);
  }
}
