import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { PreferenceReviewMutation, UnderstandingReviewMutation } from "../../../shared/contracts/reviews";
import { idempotencyKey } from "../../lib/http";
import { entriesApi } from "./api";

export function useEntryReview({
  domain,
  entryId,
  onUpdated,
}: {
  domain: AnalysisDomain;
  entryId: string;
  onUpdated(): void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const detail = useQuery({
    queryKey: ["entry", domain, entryId],
    queryFn: () => entriesApi.review(domain, entryId),
    refetchInterval: (query) =>
      ["submitted", "understanding", "analyzing"].includes(query.state.data?.entry.status ?? "") ? 2_000 : false,
  });
  async function saveReview(request: () => Promise<unknown>, failureMessage: string): Promise<boolean> {
    setSubmitting(true);
    setError(undefined);
    try {
      await request();
      await detail.refetch();
      onUpdated();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failureMessage);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm(kind: "understanding" | "preference") {
    const targetId = kind === "understanding" ? detail.data?.understanding?.id : detail.data?.preferenceAnalysis?.id;
    if (!targetId) return;
    await saveReview(
      () =>
        kind === "understanding"
          ? entriesApi.reviewUnderstanding(domain, targetId, { decision: "confirm_all", targetIds: [targetId] })
          : entriesApi.reviewPreference(domain, targetId, { decision: "confirm_all", targetIds: [targetId] }),
      "確認を保存できませんでした",
    );
  }

  async function mutateUnderstandingSnapshot(
    snapshotId: string | undefined,
    input: UnderstandingReviewMutation,
  ): Promise<boolean> {
    if (!snapshotId) return false;
    return saveReview(() => entriesApi.reviewUnderstanding(domain, snapshotId, input), "修正を保存できませんでした");
  }

  async function rejectPreferenceItem(runId: string, targetId: string, label: string) {
    if (!window.confirm(`「${label}」を好みの候補から削除しますか？`)) return;
    await saveReview(
      () => entriesApi.reviewPreference(domain, runId, { decision: "reject_selected", targetIds: [targetId] }),
      "好みの候補を削除できませんでした",
    );
  }

  async function mutatePreference(runId: string, input: PreferenceReviewMutation): Promise<boolean> {
    return saveReview(
      () => entriesApi.reviewPreference(domain, runId, input, idempotencyKey()),
      "好みの候補の修正を保存できませんでした",
    );
  }

  async function reviewDarkScope(decision: "continue" | "cancel") {
    const assessmentId = detail.data?.darkScopeAssessment?.id;
    if (!assessmentId) return;
    await saveReview(
      () => entriesApi.reviewScope(domain, assessmentId, { decision }),
      "対象範囲の判断を保存できませんでした",
    );
  }
  const value = detail.data;

  return {
    submitting,
    error,
    detail,
    confirm,
    mutateUnderstandingSnapshot,
    rejectPreferenceItem,
    mutatePreference,
    reviewDarkScope,
    value,
  };
}
