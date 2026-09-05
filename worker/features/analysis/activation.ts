import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/activation";

export async function activateAnalysisAndRebuild(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  analysisRunId: string,
) {
  const now = nowIso();
  const target = await first<{
    entry_id: string;
    revision_number: number;
    job_id: string | null;
  }>(repository.selectJobs(env.DB, [analysisRunId, ownerUserId, ownerUserId, analysisDomain]));
  if (!target) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");
  const state = await first<{
    desired_generation: number;
    built_generation: number;
  }>(repository.selectProjectionRebuildStates(env.DB, [ownerUserId]));
  const desiredGeneration = (state?.desired_generation ?? 0) + 1;
  const profileJobId = crypto.randomUUID();
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    profileJobId,
    1,
    {
      type: "profile.rebuild",
      params: { jobId: profileJobId, ownerUserId, desiredGeneration },
    },
    `profile:${ownerUserId}:${desiredGeneration}`,
    analysisRunId,
  );
  const result = await env.DB.batch([
    repository.updatePreferenceAssertions(env.DB, [ownerUserId, analysisDomain, analysisRunId]),
    repository.updateValueStanceAssertions(env.DB, [ownerUserId, analysisRunId]),
    repository.updateUserCharacterEntries(env.DB, [now, target.entry_id, ownerUserId, target.revision_number]),
    ...(target.job_id
      ? [
          repository.updateJobs(env.DB, [
            JSON.stringify({ entryId: target.entry_id, analysisRunId }),
            now,
            now,
            target.job_id,
          ]),
        ]
      : []),
    repository.insertProjectionRebuildStates(env.DB, [
      ownerUserId,
      desiredGeneration,
      state?.built_generation ?? 0,
      now,
    ]),
    repository.insertJobs(env.DB, [
      profileJobId,
      ownerUserId,
      ownerUserId,
      desiredGeneration,
      now,
      now,
      analysisDomain,
    ]),
    outbox.statement,
  ]);
  if (result.some((item) => !item.success)) throw new Error("D1_BATCH_FAILED");
  if (!result[2].meta.changes) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return {
    entryId: target.entry_id,
    profileJobId,
    outboxEventId: outbox.id,
    freshness: {
      status: "rebuilding" as const,
      desiredGeneration,
      builtGeneration: state?.built_generation ?? 0,
    },
  };
}
