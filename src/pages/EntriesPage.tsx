import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import type { CharacterEntryInput } from "../../shared/schemas";
import { TRAIT_CATEGORIES, TRAITS } from "../../shared/taxonomy";
import { api, idempotencyKey } from "../api";
import { Card, EmptyState, Modal, Notice, PageHeading, Rating, Spinner } from "../components/Ui";

type EntryItem = {
  id: string;
  kind: "existing" | "original";
  revision: number;
  workTitle: string | null;
  characterName: string | null;
  mediumOrEdition: string | null;
  overview: string;
  preferenceRating: number | null;
  likedAspects: string | null;
  dislikedAspects: string | null;
  analysisStatus: string | null;
  created_at: string;
  updated_at: string;
};

type Assertion = {
  id: string;
  traitId: string;
  label: string;
  category: keyof typeof TRAIT_CATEGORIES;
  level: number | null;
  observation: string;
  confidence: number;
  evidenceField: string;
  evidenceQuote: string;
  source: string;
};

type Job = { id: string; status: string; progress: number; errorCode?: string };

const emptyForm: CharacterEntryInput = {
  kind: "existing",
  workTitle: "",
  characterName: "",
  overview: "",
  mediumOrEdition: undefined,
  likedAspects: undefined,
  dislikedAspects: undefined,
};

export function EntriesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EntryItem | "new">();
  const [detailId, setDetailId] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const [error, setError] = useState<string>();
  const entries = useQuery({
    queryKey: ["entries"],
    queryFn: () => api<{ entries: EntryItem[] }>("/api/v1/entries"),
    refetchInterval: (query) =>
      query.state.data?.entries.some((entry) => ["queued", "running"].includes(entry.analysisStatus ?? ""))
        ? 2_000
        : false,
  });
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<{ job: Job }>(`/api/v1/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && ["succeeded", "failed", "superseded"].includes(query.state.data.job.status) ? false : 1_500,
  });

  useEffect(() => {
    if (!job.data || !["succeeded", "failed", "superseded"].includes(job.data.job.status)) return;
    queryClient.invalidateQueries({ queryKey: ["entries"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  }, [job.data, queryClient]);

  async function remove(entry: EntryItem) {
    if (!confirm(`「${entry.characterName || "名前未設定"}」を削除しますか？分析根拠からも除外されます。`)) return;
    setError(undefined);
    try {
      const response = await api<{ job: Job }>(`/api/v1/entries/${entry.id}`, {
        method: "DELETE",
        idempotencyKey: idempotencyKey(),
      });
      setJobId(response.job.id);
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "削除できませんでした");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="CHARACTER LIBRARY"
        title="キャラクター"
        description="キャラの事実と、あなたが好きな理由を分けて入力してください。作品知識は自動補完しません。"
        action={
          <button type="button" className="button button-primary" onClick={() => setEditing("new")}>
            ＋ キャラを登録
          </button>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {jobId && job.data && <JobNotice job={job.data.job} />}
      {entries.isPending && <Spinner />}
      {entries.isError && <Notice tone="danger">登録一覧を読み込めませんでした。</Notice>}
      {entries.data?.entries.length === 0 && (
        <Card>
          <EmptyState
            icon="◇"
            title="まだキャラクターがいません"
            action={
              <button type="button" className="button button-primary" onClick={() => setEditing("new")}>
                最初のキャラを登録
              </button>
            }
          >
            概要は必須、好き度や理由は後からでも追加できます。
          </EmptyState>
        </Card>
      )}
      <div className="entry-grid">
        {entries.data?.entries.map((entry) => (
          <Card className="entry-card" key={entry.id}>
            <button type="button" className="entry-main" onClick={() => setDetailId(entry.id)}>
              <div className={`entry-symbol ${entry.kind}`} aria-hidden="true">
                {entry.kind === "existing" ? "既" : "創"}
              </div>
              <div>
                <span className="entry-type">
                  {entry.kind === "existing" ? entry.workTitle : "オリジナルキャラクター"}
                </span>
                <h2>{entry.characterName || "名前未設定"}</h2>
                <p>{entry.overview}</p>
              </div>
            </button>
            <footer>
              <span className={`job-pill job-${entry.analysisStatus ?? "unknown"}`}>
                {statusLabel(entry.analysisStatus)}
              </span>
              {entry.preferenceRating && (
                <span className="mini-rating">
                  {"★".repeat(entry.preferenceRating)}
                  {"☆".repeat(5 - entry.preferenceRating)}
                </span>
              )}
              <div className="entry-actions">
                <button type="button" onClick={() => setEditing(entry)}>
                  編集
                </button>
                <button type="button" className="danger-link" onClick={() => remove(entry)}>
                  削除
                </button>
              </div>
            </footer>
          </Card>
        ))}
      </div>
      {editing && (
        <EntryFormModal
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={(nextJobId) => {
            setEditing(undefined);
            setJobId(nextJobId);
            queryClient.invalidateQueries({ queryKey: ["entries"] });
          }}
        />
      )}
      {detailId && (
        <EntryDetailModal
          entryId={detailId}
          onClose={() => setDetailId(undefined)}
          onCorrected={(nextJobId) => {
            setJobId(nextJobId);
            queryClient.invalidateQueries({ queryKey: ["entry", detailId] });
          }}
        />
      )}
    </>
  );
}

function statusLabel(status: string | null) {
  if (status === "succeeded") return "分析済み";
  if (status === "failed") return "分析エラー";
  if (status === "queued" || status === "running") return "分析中";
  if (status === "superseded") return "更新済み";
  return "未分析";
}

function JobNotice({ job }: { job: Job }) {
  if (job.status === "succeeded") return <Notice tone="success">分析が完了し、プロフィールを更新しました。</Notice>;
  if (job.status === "failed")
    return <Notice tone="danger">分析に失敗しました。入力は保存されています。編集して再試行できます。</Notice>;
  if (job.status === "superseded")
    return <Notice tone="info">より新しい更新があるため、この分析はプロフィールへ反映されませんでした。</Notice>;
  return (
    <Notice tone="info">
      <span className="inline-progress">
        <i style={{ width: `${job.progress}%` }} />
      </span>
      分析中です… {job.progress}%
    </Notice>
  );
}

function EntryFormModal({
  entry,
  onClose,
  onSaved,
}: {
  entry?: EntryItem;
  onClose(): void;
  onSaved(jobId: string): void;
}) {
  const [form, setForm] = useState<CharacterEntryInput>(() => (entry ? entryToInput(entry) : emptyForm));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function update<K extends string>(key: K, value: unknown) {
    setForm((current) => ({ ...current, [key]: value }) as CharacterEntryInput);
  }

  function changeKind(kind: "existing" | "original") {
    setForm(
      kind === "existing"
        ? {
            kind,
            workTitle: "",
            characterName: form.characterName ?? "",
            overview: form.overview,
            mediumOrEdition: undefined,
            preferenceRating: form.preferenceRating,
            likedAspects: form.likedAspects,
            dislikedAspects: form.dislikedAspects,
          }
        : {
            kind,
            characterName: form.characterName,
            overview: form.overview,
            preferenceRating: form.preferenceRating,
            likedAspects: form.likedAspects,
            dislikedAspects: form.dislikedAspects,
          },
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = entry
        ? await api<{ job: Job }>(`/api/v1/entries/${entry.id}`, {
            method: "PATCH",
            idempotencyKey: idempotencyKey(),
            body: JSON.stringify({ revision: entry.revision, entry: form }),
          })
        : await api<{ job: Job }>("/api/v1/entries", {
            method: "POST",
            idempotencyKey: idempotencyKey(),
            body: JSON.stringify(form),
          });
      onSaved(result.job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={entry ? "キャラクターを編集" : "キャラクターを登録"} onClose={onClose} wide>
      <form className="entry-form" onSubmit={submit}>
        <fieldset className="segmented">
          <legend>キャラクター種別</legend>
          <button
            type="button"
            className={form.kind === "existing" ? "active" : ""}
            onClick={() => changeKind("existing")}
          >
            既存作品
          </button>
          <button
            type="button"
            className={form.kind === "original" ? "active" : ""}
            onClick={() => changeKind("original")}
          >
            オリジナル
          </button>
        </fieldset>
        <div className="form-grid">
          {form.kind === "existing" && (
            <label>
              <span>
                作品名 <b>必須</b>
              </span>
              <input
                value={form.workTitle}
                onChange={(event) => update("workTitle", event.target.value)}
                maxLength={120}
                required
              />
            </label>
          )}
          <label>
            <span>キャラクター名 {form.kind === "existing" && <b>必須</b>}</span>
            <input
              value={form.characterName ?? ""}
              onChange={(event) => update("characterName", event.target.value)}
              maxLength={120}
              required={form.kind === "existing"}
              placeholder={form.kind === "original" ? "未定でも構いません" : ""}
            />
          </label>
          {form.kind === "existing" && (
            <label className="full">
              <span>媒体・版</span>
              <input
                value={form.mediumOrEdition ?? ""}
                onChange={(event) => update("mediumOrEdition", event.target.value)}
                maxLength={120}
                placeholder="例：アニメ版、第二部"
              />
            </label>
          )}
          <label className="full">
            <span>
              キャラクター概要 <b>必須</b>
            </span>
            <textarea
              value={form.overview}
              onChange={(event) => update("overview", event.target.value)}
              maxLength={10_000}
              rows={7}
              required
              placeholder="性格、行動、価値観、背景、関係性などを、あなたの言葉で説明してください。作品名やキャラ名から設定を自動補完することはありません。"
            />
            <small>{form.overview.length.toLocaleString()} / 10,000文字</small>
          </label>
        </div>
        <div className="preference-inputs">
          <div>
            <span className="field-label">好き度（任意）</span>
            <Rating value={form.preferenceRating} onChange={(value) => update("preferenceRating", value)} />
          </div>
          <label>
            <span>好きな点（任意）</span>
            <textarea
              value={form.likedAspects ?? ""}
              onChange={(event) => update("likedAspects", event.target.value)}
              maxLength={2_000}
              rows={3}
              placeholder="どの属性が好きなのかを明記すると、明示嗜好として強く反映されます。"
            />
          </label>
          <label>
            <span>少し苦手な点（任意）</span>
            <textarea
              value={form.dislikedAspects ?? ""}
              onChange={(event) => update("dislikedAspects", event.target.value)}
              maxLength={2_000}
              rows={3}
              placeholder="全体として好きでも、苦手な要素があれば分けて記録できます。"
            />
          </label>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <footer className="modal-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存して分析"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function entryToInput(entry: EntryItem): CharacterEntryInput {
  if (entry.kind === "existing")
    return {
      kind: "existing",
      workTitle: entry.workTitle ?? "",
      characterName: entry.characterName ?? "",
      mediumOrEdition: entry.mediumOrEdition ?? undefined,
      overview: entry.overview,
      preferenceRating: entry.preferenceRating ?? undefined,
      likedAspects: entry.likedAspects ?? undefined,
      dislikedAspects: entry.dislikedAspects ?? undefined,
    };
  return {
    kind: "original",
    characterName: entry.characterName ?? undefined,
    overview: entry.overview,
    preferenceRating: entry.preferenceRating ?? undefined,
    likedAspects: entry.likedAspects ?? undefined,
    dislikedAspects: entry.dislikedAspects ?? undefined,
  };
}

function EntryDetailModal({
  entryId,
  onClose,
  onCorrected,
}: {
  entryId: string;
  onClose(): void;
  onCorrected(jobId: string): void;
}) {
  const detail = useQuery({
    queryKey: ["entry", entryId],
    queryFn: () => api<{ entry: EntryItem; assertions: Assertion[] }>(`/api/v1/entries/${entryId}`),
  });
  const [replacementFor, setReplacementFor] = useState<Assertion>();
  const [replacementId, setReplacementId] = useState<string>(TRAITS[0][0]);
  const [error, setError] = useState<string>();

  async function correct(assertion: Assertion, action: "confirm" | "reject" | "replace") {
    setError(undefined);
    try {
      const result = await api<{ job: Job }>(`/api/v1/entries/${entryId}/corrections`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify({
          traitId: assertion.traitId,
          action,
          replacementTraitId: action === "replace" ? replacementId : undefined,
        }),
      });
      setReplacementFor(undefined);
      onCorrected(result.job.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "訂正を保存できませんでした");
    }
  }

  return (
    <Modal title="抽出された属性と根拠" onClose={onClose} wide>
      {detail.isPending && <Spinner />}
      {detail.isError && <Notice tone="danger">詳細を読み込めませんでした。</Notice>}
      {detail.data && (
        <div className="detail-content">
          <div className="source-preview">
            <p className="eyebrow">SOURCE OVERVIEW</p>
            <p>{detail.data.entry.overview}</p>
          </div>
          <p className="muted">
            訂正はモデルの再分析より優先されます。「違う」で除外するか、適切な属性へ置き換えてください。
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="assertion-list">
            {detail.data.assertions.length === 0 && (
              <p className="muted">原文に一致する属性をまだ確認できていません。</p>
            )}
            {detail.data.assertions.map((assertion) => (
              <div className="assertion-row" key={assertion.id}>
                <div>
                  <span className="trait-category">{TRAIT_CATEGORIES[assertion.category] ?? assertion.category}</span>
                  <strong>{assertion.label}</strong>
                  <blockquote>「{assertion.evidenceQuote}」</blockquote>
                </div>
                <span className="confidence-number">{Math.round(assertion.confidence * 100)}%</span>
                <div className="assertion-actions">
                  <button type="button" onClick={() => correct(assertion, "confirm")}>
                    合っている
                  </button>
                  <button type="button" onClick={() => setReplacementFor(assertion)}>
                    置き換え
                  </button>
                  <button type="button" className="danger-link" onClick={() => correct(assertion, "reject")}>
                    違う
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {replacementFor && (
        <div className="replacement-panel">
          <strong>「{replacementFor.label}」を置き換える</strong>
          <select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>
            {TRAITS.map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="button button-primary" onClick={() => correct(replacementFor, "replace")}>
            置き換えて反映
          </button>
          <button type="button" className="button button-ghost" onClick={() => setReplacementFor(undefined)}>
            やめる
          </button>
        </div>
      )}
    </Modal>
  );
}
