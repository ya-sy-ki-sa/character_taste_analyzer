import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import * as repository from "./repositories/claims";

export async function analysisFenceIsCurrent(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  attemptId: string,
): Promise<boolean> {
  return Boolean(
    await first<{ ok: number }>(
      repository.selectJobs(env.DB, [
        params.jobId,
        params.ownerUserId,
        params.entryId,
        params.inputGeneration,
        params.inputGeneration,
        attemptId,
      ]),
    ),
  );
}

export async function supersedeAnalysisClaim(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  attemptId: string,
): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    repository.updateJobAttempts(env.DB, [now, attemptId]),
    repository.updateJobs(env.DB, [now, now, params.jobId, params.ownerUserId, params.inputGeneration]),
  ]);
}
