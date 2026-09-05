import { nowIso, sha256Hex } from "../../lib/crypto";
import { createJobLlmProvider } from "../../llm/execution";
import { LlmProviderError } from "../../llm/types";
import type { Env, GenerationWorkflowParams } from "../../types";
import { claimJob, finishJobAttempt, isRetryableFailure, type JobClaim } from "../jobs/execution";
import { compileBrief } from "./brief";
import { compareCandidates, generateCandidate } from "./candidates";
import { persistModelRun } from "./model-runs";
import * as repository from "./repositories/process";
import { characterSimilarityDocument, loadSimilarityDocuments } from "./similarity";
import type { CandidateResult } from "./types";

export async function processGeneration(env: Env, params: GenerationWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  try {
    claim = await claimJob(env, params.jobId, params.ownerUserId, params.inputGeneration, "character-generation");
    if (claim.status === "attempts_exhausted") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    if (claim.status !== "claimed") return;
    const llm = await createJobLlmProvider(env, params.jobId, params.ownerUserId);
    const now = nowIso();
    await env.DB.batch([
      repository.updateJobs(env.DB, [now, params.jobId]),
      repository.updateGenerationRequests(env.DB, [
        now,
        params.generationRequestId,
        params.ownerUserId,
        params.analysisDomain,
      ]),
    ]);
    const { brief, briefRowId } = await compileBrief(env, params.ownerUserId, params.generationRequestId);
    if (brief.analysisDomain !== params.analysisDomain) throw new Error("GENERATION_DOMAIN_MISMATCH");
    await env.DB.batch([
      repository.updateJobs2(env.DB, [nowIso(), params.jobId]),
      repository.updateGenerationRequests2(env.DB, [nowIso(), params.generationRequestId]),
    ]);
    const documents = await loadSimilarityDocuments(
      env,
      params.ownerUserId,
      params.analysisDomain,
      params.generationRequestId,
    );
    const candidates: CandidateResult[] = [];
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const result = await generateCandidate(env, llm, params, brief, briefRowId, ordinal, documents);
      candidates.push(result);
      if (result.report.passed && result.similarity.passed)
        documents.push(characterSimilarityDocument(`variant:${ordinal}`, result.candidate));
    }
    const eligible = candidates.filter((item) => item.report.passed && item.similarity.passed);
    // Preserve failed inspections too; only eligible candidates are exposed by listGenerations.
    await env.DB.batch(
      candidates.map((item) =>
        repository.insertGenerationCandidates(env.DB, [
          item.id,
          params.ownerUserId,
          params.generationRequestId,
          briefRowId,
          item.ordinal,
          item.report.passed && item.similarity.passed ? "passed" : "failed",
          JSON.stringify(item.candidate),
          JSON.stringify(item.report),
          JSON.stringify(item.similarity),
          nowIso(),
          item.modelRunId,
        ]),
      ),
    );
    if (!eligible.length) throw new Error("GENERATION_CONSTRAINT_VIOLATION");
    await compareCandidates(env, llm, params, brief, eligible);
    const { candidate, modelRunId } = eligible[0];
    const characterId = crypto.randomUUID();
    const outputJson = JSON.stringify(candidate);
    const completed = nowIso();
    const statements: D1PreparedStatement[] = [
      repository.updateJobs3(env.DB, [
        JSON.stringify({ generatedCharacterId: characterId }),
        completed,
        completed,
        params.jobId,
        params.ownerUserId,
        params.inputGeneration,
      ]),
      repository.insertGeneratedCharacters(env.DB, [
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
      ]),
      repository.updateGenerationRequests3(env.DB, [
        completed,
        params.generationRequestId,
        params.ownerUserId,
        params.jobId,
        params.ownerUserId,
      ]),
      repository.updateJobAttempts(env.DB, [completed, claim.attemptId, params.jobId]),
    ];
    for (const item of eligible)
      statements.push(repository.updateGenerationCandidates(env.DB, [JSON.stringify(item.comparison), item.id]));
    for (const item of candidate.briefCoverage)
      for (const pointer of item.outputPointers)
        statements.push(
          repository.insertGenerationBasisLinks(env.DB, [
            crypto.randomUUID(),
            characterId,
            item.profileSnapshotItemId,
            pointer,
            item.treatment === "prohibit" ? "avoided" : item.treatment === "explore" ? "explored" : "realized",
            item.explanation,
            completed,
          ]),
        );
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("D1_GENERATION_PERSIST_FAILED");
    if (!results[0].meta.changes || !results[2].meta.changes || !results[3].meta.changes)
      throw new Error("GENERATION_COMMIT_FENCE_CHANGED");
  } catch (error) {
    if (error instanceof LlmProviderError) {
      for (const attempt of error.attempts) {
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
    }
    const code =
      error instanceof LlmProviderError ? error.code : error instanceof Error ? error.message : "GENERATION_FAILED";
    const now = nowIso();
    const willRetry = claim?.status === "claimed" && claim.stepAttemptNumber < 3 && isRetryableFailure(error);
    if (claim?.status === "claimed")
      await finishJobAttempt(
        env,
        claim.attemptId,
        "failed",
        code,
        error instanceof LlmProviderError ? error.safeDetail : null,
      );
    await env.DB.batch([
      repository.updateGenerationRequests4(env.DB, [
        willRetry ? "generating" : "failed",
        now,
        params.generationRequestId,
        params.ownerUserId,
        params.analysisDomain,
        params.jobId,
      ]),
      repository.updateJobs4(env.DB, [
        willRetry ? "retrying" : "failed",
        willRetry ? 1 : 0,
        code.slice(0, 100),
        error instanceof LlmProviderError ? (error.safeDetail ?? null) : null,
        willRetry ? 1 : 0,
        willRetry ? new Date(Date.now() + 5_000).toISOString() : null,
        now,
        willRetry ? null : now,
        params.jobId,
      ]),
    ]);
    if (willRetry) throw error;
  }
}
