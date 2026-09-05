import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import { finishJobAttempt, isRetryableFailure, type JobClaim } from "../jobs/execution";
import { analysisFenceIsCurrent, supersedeAnalysisClaim } from "./claims";
import { analysisErrorCode, analysisFailureMetadata, safeAnalysisErrorDetail, updateFailure } from "./failures";
import { persistCompletedLlmGroupsOnFailure, persistFailedModelRuns } from "./model-runs";
import type { CompletedLlmGroup } from "./types";

export async function handleAnalysisAttemptFailure(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  claim: JobClaim | undefined,
  completedLlmGroups: CompletedLlmGroup[],
  error: unknown,
): Promise<void> {
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
