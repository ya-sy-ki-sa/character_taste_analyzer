import type { CitationIssue } from "../../../shared/contracts/citations";
import type { DarkBaselineUnderstanding } from "../../../shared/contracts/dark-understanding";
import { nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { createJobLlmProvider } from "../../llm/execution";
import { CITATION_POLICY_VERSION, CitationRegistry } from "../../platform/provenance/registry";
import { loadInputProvenanceSources, prepareExternalProvenanceSources } from "../../platform/provenance/sources";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import { claimJob, type JobClaim } from "../jobs/execution";
import { handleAnalysisAttemptFailure } from "./attempt-failure";
import { citationAwareProvider, logCitationIssues, verifyAssertionEvidence } from "./citations";
import { supersedeAnalysisClaim } from "./claims";
import { loadEntry, loadOntology } from "./context";
import { auditDarkUnderstanding, understandDarkBaseline, understandDarkTarget } from "./llm-dark";
import { understandOne } from "./llm-understanding";
import { completedLlmGroup, persistModelRun } from "./model-runs";
import * as repository from "./repositories/understanding";
import { collectCharacterResearch } from "./research";
import { ensureDarkScope } from "./scope";
import type { CompletedLlmGroup, UnderstandingCall } from "./types";
import { understandingAssertionStatements } from "./understanding-statements";

export async function processCharacterAnalysis(env: Env, params: CharacterAnalysisWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  const completedLlmGroups: CompletedLlmGroup[] = [];
  try {
    claim = await claimJob(env, params.jobId, params.ownerUserId, params.inputGeneration, "understandCharacter");
    if (claim.status === "attempts_exhausted") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    if (claim.status !== "claimed") return;
    const entry = await loadEntry(
      env,
      params.ownerUserId,
      params.analysisDomain,
      params.entryId,
      await createJobLlmProvider(env, params.jobId, params.ownerUserId),
    );
    const ontology = await loadOntology(env, params.analysisDomain);
    const now = nowIso();
    const started = await env.DB.batch([
      repository.markUnderstandingStarted(env.DB, [now, params.jobId, params.ownerUserId, params.inputGeneration]),
      repository.updateUserCharacterEntries(env.DB, [now, params.entryId, params.ownerUserId, params.inputGeneration]),
    ]);
    if (!started[0].meta.changes || !started[1].meta.changes) {
      await supersedeAnalysisClaim(env, params, claim.attemptId);
      return;
    }
    const research = await collectCharacterResearch(env, entry.payload);
    entry.llm = await citationAwareProvider(entry.llm, research.sources);
    if (params.analysisDomain === "dark" && (await ensureDarkScope(env, params, entry, research, claim)) === "waiting")
      return;

    const calls: UnderstandingCall[] = [];
    let darkBaselineResult: Awaited<ReturnType<typeof understandDarkBaseline>> | null = null;
    let darkInitialResult: Awaited<ReturnType<typeof understandDarkTarget>> | null = null;
    if (params.analysisDomain === "dark") {
      let baseline: DarkBaselineUnderstanding | undefined;
      if (entry.registrationType === "customized_existing" && entry.baseRepresentationId) {
        darkBaselineResult = await understandDarkBaseline(env, entry, research);
        baseline = darkBaselineResult.value;
        completedLlmGroups.push(
          completedLlmGroup("dark_baseline_understanding", darkBaselineResult.inputHash, darkBaselineResult),
        );
      }
      darkInitialResult = await understandDarkTarget(env, entry, ontology, research, baseline);
      completedLlmGroups.push(
        completedLlmGroup("dark_character_understanding", darkInitialResult.inputHash, darkInitialResult),
      );
      const audited = await auditDarkUnderstanding(env, entry, darkInitialResult.value, ontology, research);
      calls.push(audited);
      completedLlmGroups.push(completedLlmGroup("dark_understanding_audit", audited.inputHash, audited));
    } else if (entry.registrationType === "customized_existing" && entry.baseRepresentationId) {
      const base = await understandOne(env, entry, entry.baseRepresentationId, "base", ontology, research);
      calls.push(base);
      completedLlmGroups.push(completedLlmGroup("character_understanding", base.inputHash, base));
      const target = await understandOne(env, entry, entry.representationId, "target", ontology, research, base.value);
      calls.push(target);
      completedLlmGroups.push(completedLlmGroup("customization_delta", target.inputHash, target));
    } else {
      const target = await understandOne(env, entry, entry.representationId, "target", ontology, research);
      calls.push(target);
      completedLlmGroups.push(
        completedLlmGroup(
          target.value.customizationDeltas.length ? "customization_delta" : "character_understanding",
          target.inputHash,
          target,
        ),
      );
    }

    const externalSources = [
      ...research.sources,
      ...[
        ...calls,
        ...(darkBaselineResult ? [darkBaselineResult] : []),
        ...(darkInitialResult ? [darkInitialResult] : []),
      ]
        .flatMap((call) => call.metadata.citations ?? [])
        .map((item) => ({
          ...item,
          excerpt: undefined,
          provider: "openai_web_search",
          trustReason: "OpenAI Web Searchの参照元または引用注釈として応答に含まれたURL",
        })),
    ];
    const externalProvenance = await prepareExternalProvenanceSources(
      env,
      params.ownerUserId,
      entry.sourceSetId,
      externalSources,
    );
    const provenanceSources = [
      ...(await loadInputProvenanceSources(env, entry.sourceSetId)),
      ...externalProvenance.sources,
    ];
    const allowedUrls = new Set(externalSources.map((source) => source.url));
    const citationRegistry = new CitationRegistry();
    await citationRegistry.add(externalSources);

    const attributeByKey = new Map(ontology.map((item) => [item.stable_key, item]));
    const commitStep = `commit-understanding:${claim.attemptId}`;
    const statements: D1PreparedStatement[] = [
      repository.acquireUnderstandingCommitFence(env.DB, [
        commitStep,
        now,
        params.jobId,
        params.ownerUserId,
        params.inputGeneration,
        params.entryId,
        params.ownerUserId,
        params.inputGeneration,
        claim.attemptId,
      ]),
      ...externalProvenance.statements,
    ];
    if (darkInitialResult) {
      for (const attempt of darkInitialResult.attempts ?? [
        { output: darkInitialResult.value, metadata: darkInitialResult.metadata },
      ]) {
        const run = await persistModelRun(
          env,
          params.ownerUserId,
          "dark_character_understanding",
          darkInitialResult.inputHash,
          attempt.output,
          attempt.metadata,
          "dark",
        );
        statements.push(run.statement);
      }
    }
    if (darkBaselineResult && entry.baseRepresentationId) {
      const baselineRuns = [];
      for (const attempt of darkBaselineResult.attempts ?? [
        { output: darkBaselineResult.value, metadata: darkBaselineResult.metadata },
      ])
        baselineRuns.push(
          await persistModelRun(
            env,
            params.ownerUserId,
            "dark_baseline_understanding",
            darkBaselineResult.inputHash,
            attempt.output,
            attempt.metadata,
            "dark",
          ),
        );
      statements.push(...baselineRuns.map((item) => item.statement));
      const baselineModelRun = baselineRuns.at(-1);
      if (!baselineModelRun) throw new Error("MODEL_RUN_MISSING");
      statements.push(
        repository.insertDarkBaselineSnapshots(env.DB, [
          crypto.randomUUID(),
          params.ownerUserId,
          entry.entryRevisionId,
          entry.baseRepresentationId,
          JSON.stringify(darkBaselineResult.value),
          await sha256Hex(JSON.stringify(darkBaselineResult.value)),
          baselineModelRun.id,
          now,
        ]),
      );
    }
    let baseSnapshotId: string | null = null;
    let reviewSnapshotId = "";
    let generation = 1;
    for (const call of calls) {
      const attemptRuns = [];
      for (const attempt of call.attempts ?? [{ output: call.value, metadata: call.metadata }])
        attemptRuns.push(
          await persistModelRun(
            env,
            params.ownerUserId,
            params.analysisDomain === "dark"
              ? "dark_understanding_audit"
              : call.value.customizationDeltas.length
                ? "customization_delta"
                : "character_understanding",
            call.inputHash,
            attempt.output,
            attempt.metadata,
            params.analysisDomain,
          ),
        );
      statements.push(...attemptRuns.map((item) => item.statement));
      const modelRun = attemptRuns.at(-1);
      if (!modelRun) throw new Error("MODEL_RUN_MISSING");
      const citationIssues: CitationIssue[] = [];
      const verifiedAssertions = await Promise.all(
        call.value.assertions.map(async (assertion) => {
          const id = crypto.randomUUID();
          const verified = await verifyAssertionEvidence(
            assertion,
            provenanceSources,
            allowedUrls,
            citationRegistry,
            { targetType: "character_assertion", targetId: id, modelRunId: modelRun.id },
            citationIssues,
          );
          return { id, ...verified };
        }),
      );
      call.value = {
        ...call.value,
        assertions: call.value.assertions.map((assertion, index) => ({
          ...assertion,
          confidence: verifiedAssertions[index].confidence,
        })),
        sourceAssessment: {
          ...call.value.sourceAssessment,
          coverage:
            verifiedAssertions.length &&
            verifiedAssertions.every(
              (item) =>
                item.evidence.length && item.evidence.every((evidence) => evidence.verificationStatus === "invalid"),
            )
              ? "none"
              : citationIssues.length && call.value.sourceAssessment.coverage === "sufficient"
                ? "partial"
                : call.value.sourceAssessment.coverage,
          limitations: [
            ...call.value.sourceAssessment.limitations,
            ...(citationIssues.length
              ? [
                  "照合できない根拠は採用しません。無効な根拠しかない属性は、修正保存するまで次の好み分析には使用しません。",
                ]
              : []),
          ].slice(-50),
        },
      };
      logCitationIssues(modelRun.id, citationIssues);
      const runId = crypto.randomUUID();
      const snapshotId = crypto.randomUUID();
      const snapshotGeneration = await first<{ next_generation: number }>(
        repository.selectCharacterUnderstandingSnapshots(env.DB, [params.ownerUserId, call.representationId]),
      );
      if (!snapshotGeneration) throw new Error("UNDERSTANDING_GENERATION_UNAVAILABLE");
      reviewSnapshotId = snapshotId;
      statements.push(
        repository.insertCharacterUnderstandingRuns(env.DB, [
          runId,
          params.ownerUserId,
          entry.entryRevisionId,
          call.representationId,
          entry.sourceSetId,
          generation,
          modelRun.id,
          now,
          now,
          now,
          params.jobId,
          params.ownerUserId,
          commitStep,
        ]),
      );
      statements.push(
        repository.insertCharacterUnderstandingSnapshots(env.DB, [
          snapshotId,
          params.ownerUserId,
          runId,
          call.representationId,
          baseSnapshotId,
          entry.sourceSetId,
          snapshotGeneration.next_generation,
          entry.payload.preferenceContext ?? null,
          JSON.stringify({
            ...call.value.sourceAssessment,
            citationIssues,
            citationPolicyVersion: CITATION_POLICY_VERSION,
          }),
          JSON.stringify(
            "darkState" in call.value
              ? { ...call.value.summary, darkState: call.value.darkState, auditNotes: call.value.auditNotes }
              : call.value.summary,
          ),
          JSON.stringify(call.value.uncertainties),
          modelRun.id,
          params.analysisDomain === "dark" ? "dark-1.0" : "1.0",
          await sha256Hex(JSON.stringify(call.value)),
          now,
        ]),
      );

      statements.push(
        ...understandingAssertionStatements(env.DB, {
          ownerUserId: params.ownerUserId,
          entryRevisionId: entry.entryRevisionId,
          snapshotId,
          value: call.value,
          verifiedAssertions,
          attributeByKey,
          now,
        }),
      );
      baseSnapshotId = snapshotId;
      generation += 1;
    }
    statements.push(
      repository.markEntryAwaitingUnderstandingReview(env.DB, [
        now,
        params.entryId,
        params.ownerUserId,
        params.inputGeneration,
        params.jobId,
        commitStep,
      ]),
    );
    statements.push(
      repository.awaitUnderstandingReview(env.DB, [
        JSON.stringify({
          entryId: params.entryId,
          reviewTargetId: reviewSnapshotId,
        }),
        now,
        params.jobId,
        params.ownerUserId,
        params.inputGeneration,
        commitStep,
      ]),
    );
    statements.push(repository.updateJobAttempts(env.DB, [now, claim.attemptId, params.jobId]));
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("D1_BATCH_FAILED");
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
