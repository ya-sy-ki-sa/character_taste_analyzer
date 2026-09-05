import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/delete";

export async function deleteGeneration(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  generationRequestId: string,
) {
  const target = await first<{ status: string }>(
    repository.selectGenerationRequests(env.DB, [generationRequestId, ownerUserId, analysisDomain]),
  );
  if (!target) throw new Error("GENERATION_NOT_FOUND");
  if (!["generated", "failed", "cancelled"].includes(target.status)) throw new Error("GENERATION_DELETE_IN_PROGRESS");
  const terminalGuard = repository.terminalGuard();
  const statements = [
    repository.deleteGeneratedCharacters(env.DB, terminalGuard, [
      generationRequestId,
      ownerUserId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteGenerationValidationRuns(env.DB, terminalGuard, [
      generationRequestId,
      ownerUserId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteGenerationBriefs(env.DB, terminalGuard, [
      generationRequestId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteGenerationRequestPreferences(env.DB, terminalGuard, [
      generationRequestId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteOutboxEvents(env.DB, terminalGuard, [
      ownerUserId,
      ownerUserId,
      generationRequestId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteJobs(env.DB, terminalGuard, [
      ownerUserId,
      generationRequestId,
      generationRequestId,
      ownerUserId,
      analysisDomain,
    ]),
    repository.deleteGenerationRequests(env.DB, [generationRequestId, ownerUserId, analysisDomain]),
  ];
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_GENERATION_DELETE_FAILED");
  if (!results.at(-1)?.meta.changes) throw new Error("GENERATION_DELETE_STATE_CHANGED");
  return { generationRequestId };
}
