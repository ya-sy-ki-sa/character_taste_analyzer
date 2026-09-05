import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { EntrySummary } from "../../../shared/contracts/entries-response";
import { buildCharacterMarkdown, characterMarkdownFilename } from "../../lib/entry-markdown";
import { jobsApi } from "../jobs/api";
import { entriesApi } from "./api";

export function useEntries({ domain }: { domain: AnalysisDomain }) {
  const dark = domain === "dark";
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string>();
  const [reanalysisId, setReanalysisId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [downloadingId, setDownloadingId] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; message: string }>();
  const entries = useQuery({
    queryKey: ["entries", domain],
    queryFn: () => entriesApi.list(domain),
    refetchInterval: (query) =>
      query.state.data?.entries.some(
        (entry) =>
          ["submitted", "understanding", "analyzing"].includes(entry.status) ||
          ["queued", "running"].includes(entry.job?.status ?? ""),
      )
        ? 2_000
        : false,
  });

  async function remove(entry: EntrySummary) {
    const isAnalysisError = entry.status === "failed";
    const confirmation = isAnalysisError
      ? `「${entry.title}」の解析エラーとなった登録を除外しますか？`
      : `「${entry.title}」を好みの集計から除外しますか？`;
    if (!window.confirm(confirmation)) return;
    try {
      await entriesApi.archive(domain, entry.id);
      setNotice({
        tone: "success",
        message: isAnalysisError
          ? "解析エラーとなった登録を除外しました。"
          : "登録を除外し、好みプロフィールを再集計しました。",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["entries", domain] }),
        queryClient.invalidateQueries({ queryKey: ["profile", domain] }),
      ]);
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "除外できませんでした" });
    }
  }

  async function retry(entry: EntrySummary) {
    if (!entry.job) return;
    setRetryingId(entry.id);
    setNotice(undefined);
    try {
      await jobsApi.retry(domain, entry.job.id);
      setNotice({ tone: "info", message: `「${entry.title}」の解析を再実行しています。` });
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "再実行できませんでした" });
    } finally {
      setRetryingId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["entries", domain] });
    }
  }

  async function downloadCharacterInformation(entry: EntrySummary) {
    setDownloadingId(entry.id);
    setNotice(undefined);
    try {
      const detail = await entriesApi.review(domain, entry.id);
      const blob = new Blob([buildCharacterMarkdown(detail)], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = characterMarkdownFilename(detail.entry.draft);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "登録情報をダウンロードできませんでした",
      });
    } finally {
      setDownloadingId(undefined);
    }
  }

  return {
    dark,
    queryClient,
    formOpen,
    setFormOpen,
    detailId,
    setDetailId,
    reanalysisId,
    setReanalysisId,
    retryingId,
    downloadingId,
    notice,
    setNotice,
    entries,
    remove,
    retry,
    downloadCharacterInformation,
  };
}
