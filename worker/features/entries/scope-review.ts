import type { DarkScopeReviewRequest } from "../../../shared/contracts/dark-understanding";
import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/scope-review";

export async function reviewDarkScopeAssessment(
  env: Env,
  ownerUserId: string,
  assessmentId: string,
  input: DarkScopeReviewRequest,
): Promise<{ entryId: string; status: "queued" | "cancelled"; outboxEventId: string | null }> {
  const target = await first<{
    entry_id: string;
    revision_number: number;
    job_id: string;
    status: string;
  }>(repository.selectDarkScopeAssessments(env.DB, [assessmentId, ownerUserId, ownerUserId]));
  if (!target) throw new Error("DARK_SCOPE_REVIEW_NOT_FOUND");
  if (target.status === "cancelled") return { entryId: target.entry_id, status: "cancelled", outboxEventId: null };
  if (target.status === "overridden") return { entryId: target.entry_id, status: "queued", outboxEventId: null };
  if (target.status !== "proposed") throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
  const now = nowIso();
  if (input.decision === "cancel") {
    const results = await env.DB.batch([
      repository.updateDarkScopeAssessments(env.DB, [now, assessmentId, ownerUserId]),
      repository.updateUserCharacterEntries(env.DB, [now, now, target.entry_id, ownerUserId]),
      repository.updateJobs(env.DB, [now, now, target.job_id, ownerUserId]),
    ]);
    if (results.some((item) => !item.success || !item.meta.changes)) throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
    return { entryId: target.entry_id, status: "cancelled", outboxEventId: null };
  }
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    target.job_id,
    2,
    {
      type: "analysis.start",
      params: {
        jobId: target.job_id,
        ownerUserId,
        entryId: target.entry_id,
        stage: "understanding",
        inputGeneration: target.revision_number,
        analysisDomain: "dark",
      },
    },
    `dark-scope:${target.job_id}:${target.revision_number}:override`,
    assessmentId,
  );
  const results = await env.DB.batch([
    repository.updateDarkScopeAssessments2(env.DB, [now, assessmentId, ownerUserId]),
    repository.updateUserCharacterEntries2(env.DB, [now, target.entry_id, ownerUserId]),
    repository.updateJobs2(env.DB, [now, target.job_id, ownerUserId]),
    outbox.statement,
  ]);
  if (
    results.some((item) => !item.success) ||
    !results[0].meta.changes ||
    !results[1].meta.changes ||
    !results[2].meta.changes
  )
    throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
  return { entryId: target.entry_id, status: "queued", outboxEventId: outbox.id };
}
