import { nowIso, sha256Hex } from "../../lib/crypto";
import { createJobLlmProvider } from "../../llm/execution";
import { LlmProviderError } from "../../llm/types";
import type { Env, GenerationWorkflowParams } from "../../types";
import { claimJob, isRetryableFailure, type JobClaim } from "../jobs/execution";
import { compileBrief } from "./brief";
import { compareCandidates, generateCandidate } from "./candidates";
import { loadCandidateCheckpoints } from "./checkpoints";
import { generationFenceIsCurrent, guardGenerationProvider } from "./claims";
import { persistModelRun } from "./model-runs";
import * as repository from "./repositories/process";
import { characterSimilarityDocument, inspectGenerationSimilarity, loadSimilarityDocuments } from "./similarity";
import type { CandidateResult, GenerationFence } from "./types";

export async function processGeneration(env: Env, params: GenerationWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  let fence: GenerationFence | undefined;
  try {
    claim = await claimJob(env, params.jobId, params.ownerUserId, params.inputGeneration, "character-generation");
    if (claim.status !== "claimed" && claim.status !== "attempts_exhausted") return;
    const activeFence = { ...params, attemptId: claim.status === "claimed" ? claim.attemptId : null };
    fence = activeFence;
    if (claim.status !== "claimed") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    const llm = guardGenerationProvider(
      env,
      await createJobLlmProvider(env, params.jobId, params.ownerUserId),
      activeFence,
    );
    const started = await repository.updateJobs(env.DB, [nowIso(), params.jobId], activeFence).run();
    if (!started.meta.changes) return;
    const { brief, briefRowId } = await compileBrief(env, params.ownerUserId, params.generationRequestId, activeFence);
    if (brief.analysisDomain !== params.analysisDomain) throw new Error("GENERATION_DOMAIN_MISMATCH");
    const generating = await env.DB.batch([
      repository.markJobGenerating(env.DB, [nowIso(), params.jobId], activeFence),
      repository.markRequestGenerating(env.DB, [nowIso(), params.generationRequestId], activeFence),
    ]);
    if (generating.some((result) => !result.meta.changes)) throw new Error("GENERATION_ATTEMPT_SUPERSEDED");
    const documents = await loadSimilarityDocuments(
      env,
      params.ownerUserId,
      params.analysisDomain,
      params.generationRequestId,
    );
    const checkpoints = await loadCandidateCheckpoints(env, params, brief);
    const candidates: CandidateResult[] = [];
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const checkpoint = checkpoints.get(ordinal);
      // The registered/generated corpus may have changed since the previous attempt.
      const similarity = checkpoint
        ? await inspectGenerationSimilarity(env, params.ownerUserId, brief, checkpoint.candidate, documents)
        : null;
      const result =
        checkpoint && similarity?.passed
          ? { ...checkpoint, similarity }
          : await generateCandidate(env, llm, params, brief, briefRowId, ordinal, documents, activeFence);
      // Save each complete inspection, so a later candidate/comparison failure can resume here.
      const saved = await repository
        .insertGenerationCandidates(
          env.DB,
          [
            result.id,
            params.ownerUserId,
            params.generationRequestId,
            briefRowId,
            result.ordinal,
            result.report.passed && result.similarity.passed ? "passed" : "failed",
            JSON.stringify(result.candidate),
            JSON.stringify(result.report),
            JSON.stringify(result.similarity),
            nowIso(),
            result.modelRunId,
          ],
          activeFence,
        )
        .run();
      if (!saved.meta.changes) throw new Error("GENERATION_ATTEMPT_SUPERSEDED");
      candidates.push(result);
      if (result.report.passed && result.similarity.passed)
        documents.push(characterSimilarityDocument(`variant:${ordinal}`, result.candidate));
    }
    const eligible = candidates.filter((item) => item.report.passed && item.similarity.passed);
    if (!eligible.length) throw new Error("GENERATION_CONSTRAINT_VIOLATION");
    await compareCandidates(env, llm, params, brief, eligible);
    const { candidate, modelRunId } = eligible[0];
    const characterId = crypto.randomUUID();
    const outputJson = JSON.stringify(candidate);
    const completed = nowIso();
    const statements: D1PreparedStatement[] = [
      repository.insertGeneratedCharacters(
        env.DB,
        [
          characterId,
          params.ownerUserId,
          params.generationRequestId,
          briefRowId,
          params.analysisDomain === "dark" ? "dark-1.0" : "1.0",
          outputJson,
          await sha256Hex(outputJson),
          modelRunId,
          completed,
          completed,
          params.jobId,
          params.ownerUserId,
        ],
        activeFence,
      ),
      repository.completeGenerationRequest(
        env.DB,
        [completed, params.generationRequestId, params.ownerUserId, params.jobId, params.ownerUserId],
        activeFence,
      ),
      ...eligible.map((item) =>
        repository.updateGenerationCandidates(env.DB, [JSON.stringify(item.comparison), item.id], activeFence),
      ),
    ];
    for (const item of candidate.briefCoverage)
      for (const pointer of item.outputPointers)
        statements.push(
          repository.insertGenerationBasisLinks(
            env.DB,
            [
              crypto.randomUUID(),
              characterId,
              item.profileSnapshotItemId,
              pointer,
              item.treatment === "prohibit" ? "avoided" : item.treatment === "explore" ? "explored" : "realized",
              item.explanation,
              completed,
            ],
            activeFence,
          ),
        );
    // Finish the attempt only after its result writes. Complete the job last, using that exact finished attempt.
    statements.push(
      repository.finishGenerationAttempt(
        env.DB,
        ["succeeded", completed, null, null, claim.attemptId, params.jobId],
        activeFence,
      ),
      repository.completeGenerationJob(
        env.DB,
        [
          JSON.stringify({ generatedCharacterId: characterId }),
          completed,
          completed,
          params.jobId,
          params.ownerUserId,
          params.inputGeneration,
        ],
        activeFence,
      ),
    );
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("D1_GENERATION_PERSIST_FAILED");
    if (results.some((result) => !result.meta.changes)) throw new Error("GENERATION_COMMIT_FENCE_CHANGED");
  } catch (error) {
    if (!fence) throw error;
    // An obsolete attempt must not mark the newer attempt failed or rewrite its checkpoints.
    if (!(await generationFenceIsCurrent(env, fence))) return;
    if (error instanceof LlmProviderError) {
      for (const attempt of error.attempts)
        await persistModelRun(
          env,
          params.ownerUserId,
          attempt.metadata.promptHash ?? attempt.metadata.rootRequestId ?? "provider-failure",
          attempt.output,
          attempt.metadata,
          error.operation ?? "provider_attempt",
          params.analysisDomain,
        );
    }
    const code =
      error instanceof LlmProviderError ? error.code : error instanceof Error ? error.message : "GENERATION_FAILED";
    const now = nowIso();
    const willRetry = claim?.status === "claimed" && claim.stepAttemptNumber < 3 && isRetryableFailure(error);
    const statements = [
      repository.recordGenerationRequestFailure(
        env.DB,
        [
          willRetry ? "generating" : "failed",
          now,
          params.generationRequestId,
          params.ownerUserId,
          params.analysisDomain,
          params.jobId,
        ],
        fence,
      ),
    ];
    if (claim?.status === "claimed")
      statements.push(
        repository.finishGenerationAttempt(
          env.DB,
          [
            "failed",
            now,
            code,
            error instanceof LlmProviderError ? (error.safeDetail ?? null) : null,
            claim.attemptId,
            params.jobId,
          ],
          fence,
        ),
      );
    statements.push(
      repository.recordGenerationJobFailure(
        env.DB,
        [
          willRetry ? "retrying" : "failed",
          willRetry ? 1 : 0,
          code.slice(0, 100),
          error instanceof LlmProviderError ? (error.safeDetail ?? null) : null,
          willRetry ? 1 : 0,
          willRetry ? new Date(Date.now() + 5_000).toISOString() : null,
          now,
          willRetry ? null : now,
          params.jobId,
        ],
        fence,
      ),
    );
    const failed = await env.DB.batch(statements);
    if (failed.some((result) => !result.success)) throw new Error("D1_GENERATION_FAILURE_PERSIST_FAILED");
    if (willRetry && failed.every((result) => result.meta.changes)) throw error;
  }
}
