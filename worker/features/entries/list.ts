import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import type { EntrySummary } from "../../../shared/contracts/entries-response";
import { all } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/list";

export async function listEntries(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
): Promise<EntrySummary[]> {
  const rows = await all<{
    id: string;
    registration_type: EntrySummary["registrationType"];
    status: string;
    active_revision_number: number;
    updated_at: string;
    registration_payload_json: string;
    review_target_id: string | null;
    job_id: string | null;
    job_status: string | null;
    retryable: number | null;
    current_step: string | null;
    progress_current: number | null;
    progress_total: number | null;
    error_code: string | null;
    error_detail_safe: string | null;
  }>(repository.selectCharacterUnderstandingSnapshots(env.DB, [ownerUserId, analysisDomain]));
  return rows.map((row) => {
    const draft = JSON.parse(row.registration_payload_json) as AnyEntryDraft;
    return {
      id: row.id,
      registrationType: row.registration_type,
      status: row.status,
      title: draft.characterName,
      subtitle: draft.registrationType === "original" ? "オリジナル" : draft.workTitle,
      activeRevisionNumber: row.active_revision_number,
      updatedAt: row.updated_at,
      reviewTargetId: row.review_target_id,
      job: row.job_id
        ? {
            id: row.job_id,
            status: row.job_status ?? "queued",
            retryable: row.retryable === 1,
            currentStep: row.current_step,
            progressCurrent: row.progress_current ?? 0,
            progressTotal: row.progress_total ?? 15,
            errorCode: row.error_code,
            errorDetail: row.error_detail_safe,
          }
        : null,
    };
  });
}
