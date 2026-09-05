import { nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { CharacterAnalysisWorkflowParams, Env } from "../../types";
import type { JobClaim } from "../jobs/execution";
import { assessDarkScope } from "./llm-dark";
import { persistModelRun } from "./model-runs";
import * as repository from "./repositories/scope";
import type { CharacterResearch } from "./research";
import type { EntryContext } from "./types";

export async function ensureDarkScope(
  env: Env,
  params: CharacterAnalysisWorkflowParams,
  entry: EntryContext,
  research: CharacterResearch,
  claim: Extract<JobClaim, { status: "claimed" }>,
): Promise<"continue" | "waiting"> {
  const existing = await first<{ status: "accepted" | "overridden" | "cancelled" | "proposed" }>(
    repository.selectDarkScopeAssessments(env.DB, [params.ownerUserId, entry.entryRevisionId]),
  );
  if (existing?.status === "accepted" || existing?.status === "overridden") return "continue";
  if (existing?.status === "cancelled") throw new Error("DARK_SCOPE_CANCELLED");
  if (existing?.status === "proposed") return "waiting";

  const assessment = await assessDarkScope(env, entry, research);
  const run = await persistModelRun(
    env,
    params.ownerUserId,
    "dark_scope_assessment",
    assessment.inputHash,
    assessment.value,
    assessment.metadata,
    "dark",
  );
  const assessmentId = crypto.randomUUID();
  const now = nowIso();
  const needsReview = assessment.value.verdict === "out_of_scope";
  const statements: D1PreparedStatement[] = [
    run.statement,
    repository.insertDarkScopeAssessments(env.DB, [
      assessmentId,
      params.ownerUserId,
      entry.entryRevisionId,
      assessment.value.verdict,
      needsReview ? "proposed" : "accepted",
      JSON.stringify(assessment.value),
      run.id,
      now,
      needsReview ? null : now,
    ]),
  ];
  if (needsReview) {
    statements.push(
      repository.updateUserCharacterEntries(env.DB, [now, params.entryId, params.ownerUserId, params.inputGeneration]),
      repository.updateJobs(env.DB, [
        JSON.stringify({ entryId: params.entryId, reviewTargetId: assessmentId }),
        now,
        params.jobId,
        params.ownerUserId,
        params.inputGeneration,
      ]),
      repository.updateJobAttempts(env.DB, [now, claim.attemptId, params.jobId]),
    );
  }
  const results = await env.DB.batch(statements);
  if (results.some((item) => !item.success)) throw new Error("DARK_SCOPE_PERSIST_FAILED");
  if (needsReview && (!results.at(-3)?.meta.changes || !results.at(-2)?.meta.changes || !results.at(-1)?.meta.changes))
    throw new Error("JOB_COMMIT_FENCE_CHANGED");
  return needsReview ? "waiting" : "continue";
}
