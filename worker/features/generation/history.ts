import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GenerationOption } from "../../../shared/contracts/generation-response";
import { all } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/history";

export async function listGenerations(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain = "standard") {
  const rows = await all<{
    id: string | null;
    request_id: string;
    status: string;
    mode: string;
    created_at: string;
    character_json: string | null;
    job_status: string | null;
    error_code: string | null;
  }>(repository.selectGenerationRequests(env.DB, [ownerUserId, analysisDomain]));
  const candidates = await all<{
    id: string;
    generation_request_id: string;
    ordinal: number;
    character_json: string;
    comparison_json: string;
    selected_at: string | null;
  }>(repository.selectGenerationCandidates(env.DB, [ownerUserId, analysisDomain]));
  const candidatesByRequest = new Map<string, GenerationOption[]>();
  for (const item of candidates) {
    const requestCandidates = candidatesByRequest.get(item.generation_request_id) ?? [];
    requestCandidates.push({
      id: item.id,
      ordinal: item.ordinal,
      character: JSON.parse(item.character_json),
      comparison: JSON.parse(item.comparison_json),
      selected: Boolean(item.selected_at),
    });
    candidatesByRequest.set(item.generation_request_id, requestCandidates);
  }
  return rows.map((row) => ({
    id: row.id,
    generationRequestId: row.request_id,
    status: row.status,
    mode: row.mode,
    createdAt: row.created_at,
    character: row.character_json ? JSON.parse(row.character_json) : null,
    candidates: candidatesByRequest.get(row.request_id) ?? [],
    job: { status: row.job_status, errorCode: row.error_code },
  }));
}
