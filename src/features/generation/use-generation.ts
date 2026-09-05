import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GenerationRequestInput } from "../../../shared/contracts/generation";
import type { GenerationOption, GenerationRow } from "../../../shared/contracts/generation-response";
import {
  expandSnapshotTreatments,
  groupGenerationSnapshotItems,
  type SnapshotTreatment,
} from "../../lib/generation-snapshot-items";
import { idempotencyKey } from "../../lib/http";
import { profileApi } from "../profile/api";
import { generationApi } from "./api";

export function useGeneration({ domain }: { domain: AnalysisDomain }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<GenerationRequestInput["mode"]>("balanced");
  const [purpose, setPurpose] = useState("物語に登場する一人のキャラクターを作る");
  const [world, setWorld] = useState("");
  const [genre, setGenre] = useState("");
  const [role, setRole] = useState("");
  const [tone, setTone] = useState("");
  const [instruction, setInstruction] = useState("");
  const [treatments, setTreatments] = useState<Record<string, SnapshotTreatment>>({});
  const [overrides, setOverrides] = useState<Record<string, SnapshotTreatment>>({});
  const [selecting, setSelecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [detail, setDetail] = useState<GenerationRow>();
  const snapshot = useQuery({
    queryKey: ["profile-snapshot-items", domain],
    queryFn: () => profileApi.snapshotItems(domain),
  });
  const generations = useQuery({
    queryKey: ["generation-requests", domain],
    queryFn: () => generationApi.list(domain),
    refetchInterval: (query) =>
      query.state.data?.generations.some((item) => ["draft", "brief_ready", "generating"].includes(item.status))
        ? 2_000
        : false,
  });
  const groupedSnapshotItems = groupGenerationSnapshotItems(snapshot.data?.items ?? []);

  useEffect(() => {
    const items = groupGenerationSnapshotItems(snapshot.data?.items ?? []);
    if (!snapshot.data?.snapshot || !items?.length) return;
    setTreatments((current) => {
      if (Object.keys(current).length) return current;
      return Object.fromEntries(
        items.map((item, index) => [
          item.id,
          index < 8 && item.type !== "negative_preference"
            ? "include"
            : item.type === "negative_preference"
              ? "prohibit"
              : "omit",
        ]),
      );
    });
  }, [snapshot.data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const { selectedItemIds, prohibitedItemIds } = expandSnapshotTreatments(
      groupedSnapshotItems,
      treatments,
      overrides,
    );
    try {
      if (!snapshot.data?.snapshot) throw new Error("生成に使うプロフィールを読み込んでください。");
      await generationApi.create(
        domain,
        {
          mode,
          profileSnapshotId: snapshot.data.snapshot.id,
          purpose,
          world: world || undefined,
          genre: genre || undefined,
          role: role || undefined,
          tone: tone || undefined,
          freeInstruction: instruction || undefined,
          selectedItemIds,
          prohibitedItemIds,
        },
        idempotencyKey(),
      );
      await queryClient.invalidateQueries({ queryKey: ["generation-requests", domain] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成を開始できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeHistory(item: GenerationRow) {
    const title = item.character?.identity.name ?? (item.status === "failed" ? "失敗した生成" : "この生成");
    if (!window.confirm(`「${title}」の作成履歴を削除しますか？`)) return;
    setDeletingId(item.generationRequestId);
    setError(undefined);
    setNotice(undefined);
    try {
      await generationApi.delete(domain, item.generationRequestId);
      if (detail?.generationRequestId === item.generationRequestId) setDetail(undefined);
      await queryClient.invalidateQueries({ queryKey: ["generation-requests", domain] });
      setNotice("作成履歴を削除しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作成履歴を削除できませんでした");
    } finally {
      setDeletingId(undefined);
    }
  }

  async function selectCandidate(option: GenerationOption) {
    if (!detail) return;
    setSelecting(true);
    setError(undefined);
    try {
      await generationApi.select(domain, detail.generationRequestId, { candidateId: option.id });
      setDetail({
        ...detail,
        character: option.character,
        candidates: detail.candidates.map((item) => ({ ...item, selected: item.id === option.id })),
      });
      await queryClient.invalidateQueries({ queryKey: ["generation-requests", domain] });
      setNotice("採用する案を保存しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "採用を保存できませんでした");
    } finally {
      setSelecting(false);
    }
  }
  const selectedCount = expandSnapshotTreatments(groupedSnapshotItems, treatments, overrides).selectedItemIds.length;

  return {
    mode,
    setMode,
    purpose,
    setPurpose,
    world,
    setWorld,
    genre,
    setGenre,
    role,
    setRole,
    tone,
    setTone,
    instruction,
    setInstruction,
    treatments,
    setTreatments,
    overrides,
    setOverrides,
    selecting,
    submitting,
    deletingId,
    error,
    notice,
    detail,
    setDetail,
    snapshot,
    generations,
    groupedSnapshotItems,
    submit,
    removeHistory,
    selectCandidate,
    selectedCount,
  };
}
