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
  async function confirm(kind: "understanding" | "preference") {
    const targetId = kind === "understanding" ? detail.data?.understanding?.id : detail.data?.preferenceAnalysis?.id;
    if (!targetId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await (kind === "understanding"
        ? entriesApi.reviewUnderstanding(domain, targetId, { decision: "confirm_all", targetIds: [targetId] })
        : entriesApi.reviewPreference(domain, targetId, { decision: "confirm_all", targetIds: [targetId] }));
      await detail.refetch();
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "確認を保存できませんでした");
    } finally {
      setSubmitting(false);
    }
  }
  async function mutateUnderstandingSnapshot(
    snapshotId: string | undefined,
    input: UnderstandingReviewMutation,
  ): Promise<boolean> {
    if (!snapshotId) return false;
    setSubmitting(true);
    setError(undefined);
    try {
      await entriesApi.reviewUnderstanding(domain, snapshotId, input);
      await detail.refetch();
      onUpdated();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修正を保存できませんでした");
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  async function rejectPreferenceItem(runId: string, targetId: string, label: string) {
    if (!window.confirm(`「${label}」を好みの候補から削除しますか？`)) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await entriesApi.reviewPreference(domain, runId, { decision: "reject_selected", targetIds: [targetId] });
      await detail.refetch();
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "好みの候補を削除できませんでした");
    } finally {
      setSubmitting(false);
    }
  }
  async function mutatePreference(runId: string, input: PreferenceReviewMutation): Promise<boolean> {
    setSubmitting(true);
    setError(undefined);
    try {
      await entriesApi.reviewPreference(domain, runId, input, idempotencyKey());
      await detail.refetch();
      onUpdated();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "好みの候補の修正を保存できませんでした");
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  async function reviewDarkScope(decision: "continue" | "cancel") {
    const assessmentId = detail.data?.darkScopeAssessment?.id;
    if (!assessmentId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await entriesApi.reviewScope(domain, assessmentId, { decision });
      await detail.refetch();
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "対象範囲の判断を保存できませんでした");
    } finally {
      setSubmitting(false);
    }
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
