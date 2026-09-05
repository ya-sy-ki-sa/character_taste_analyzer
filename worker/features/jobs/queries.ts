import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/queries";
export function loadJob(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain, jobId: string) {
  return first<Record<string, unknown>>(repository.selectJobs(env.DB, [jobId, ownerUserId, analysisDomain]));
}
