import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/archive";

export async function archiveEntry(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain, entryId: string) {
  const now = nowIso();
  const state = await first<{ desired_generation: number; built_generation: number }>(
    repository.selectProjectionRebuildStates(env.DB, [ownerUserId]),
  );
  const desiredGeneration = (state?.desired_generation ?? 0) + 1;
  const jobId = crypto.randomUUID();
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    {
      type: "profile.rebuild",
      params: { jobId, ownerUserId, desiredGeneration },
    },
    `profile:${ownerUserId}:${desiredGeneration}`,
    entryId,
  );
  const results = await env.DB.batch([
    repository.updateUserCharacterEntries(env.DB, [now, now, entryId, ownerUserId, analysisDomain]),
    repository.insertProjectionRebuildStates(env.DB, [
      ownerUserId,
      desiredGeneration,
      state?.built_generation ?? 0,
      now,
    ]),
    repository.insertJobs(env.DB, [jobId, ownerUserId, ownerUserId, desiredGeneration, now, now, analysisDomain]),
    outbox.statement,
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_ARCHIVE_FAILED");
  if (!results[0].meta.changes) throw new Error("ENTRY_NOT_FOUND");
  return { outboxEventId: outbox.id };
}
