import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { responseChannelCatalog, responseChannelCategories } from "../../shared/response-channels";
import type { EntryDraft, EntrySummary, RegistrationType, ResponseChannel } from "../../shared/schemas";
import { api, idempotencyKey } from "../api";
import { Card, EmptyState, Modal, Notice, PageHeading, Spinner } from "../components/Ui";

type EntryList = { entries: EntrySummary[] };
type ReviewDetail = {
  entry: { id: string; status: string; registrationType: RegistrationType; draft: EntryDraft };
  understanding: null | {
    id: string;
    sourceAssessment: { coverage: string; limitations: string[] };
    summary: Record<string, string | string[]>;
    uncertainties: Array<{ topic: string; reason: string }>;
    confidence: number;
    assertions: Array<{
      id: string;
      raw_label: string;
      value_text: string;
      explicitness: string;
      confidence: number;
      status: string;
    }>;
    deltas: Array<{
      id: string;
      operation: string;
      before_value: string | null;
      after_value: string | null;
      reason_text: string | null;
      confidence: number;
    }>;
  };
  baseUnderstanding: null | {
    id: string;
    sourceAssessment: { coverage: string; limitations: string[] };
    summary: Record<string, string | string[]>;
    uncertainties: Array<{ topic: string; reason: string }>;
    confidence: number;
    assertions: Array<{
      id: string;
      raw_label: string;
      value_text: string;
      explicitness: string;
      confidence: number;
      status: string;
    }>;
  };
  preferenceAnalysis: null | {
    id: string;
    summary: { userExplicitSummary: string[]; inferredSummary: string[]; limitations: string[] };
    uncertainties: Array<{ topic: string; reason: string }>;
    assertions: Array<{
      id: string;
      raw_label: string;
      polarity: string;
      response_channel: string;
      strength: number;
      explicitness: string;
      confidence: number;
      status: string;
    }>;
    valueStances: Array<{
      id: string;
      target_ref: string;
      stance: string;
      orientation: string;
      explicitness: string;
      confidence: number;
      status: string;
    }>;
  };
};

type FormState = {
  registrationType: RegistrationType;
  workTitle: string;
  characterName: string;
  mediaType: string;
  preferenceContext: string;
  characterBasicInfo: string;
  referenceMaterial: string;
  userCharacterView: string;
  representationType: "user_interpretation" | "transformative" | "alternate_setting";
  customizationDescription: string;
  likedReasons: string;
  dislikedReasons: string;
  responseChannels: ResponseChannel[];
  valueStanceNote: string;
};

const emptyForm: FormState = {
  registrationType: "existing",
  workTitle: "",
  characterName: "",
  mediaType: "",
  preferenceContext: "",
  characterBasicInfo: "",
  referenceMaterial: "",
  userCharacterView: "",
  representationType: "user_interpretation",
  customizationDescription: "",
  likedReasons: "",
  dislikedReasons: "",
  responseChannels: ["person_liking"],
  valueStanceNote: "",
};

const popularChannelOptions = responseChannelCatalog.filter((item) => item.tier === "popular");
const detailedChannelOptions = responseChannelCatalog.filter((item) => item.tier === "detail");

const statusLabels: Record<string, string> = {
  submitted: "理解を解析中",
  understanding: "理解を解析中",
  understanding_review: "基本像の確認待ち",
  analyzing: "嗜好を解析中",
  analysis_review: "嗜好候補の確認待ち",
  active: "解析済み",
  failed: "解析エラー",
  archived: "除外済み",
};

const analysisErrorLabels: Record<string, string> = {
  PREFERENCE_ANALYSIS_EMPTY: "嗜好候補を生成できませんでした",
};

const reanalyzableStatuses = new Set(["understanding_review", "analysis_review", "active", "failed"]);

export function EntriesPage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string>();
  const [reanalysisId, setReanalysisId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; message: string }>();
  const entries = useQuery({
    queryKey: ["entries"],
    queryFn: () => api<EntryList>("/api/v1/entries"),
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
    if (!window.confirm(`「${entry.title}」を嗜好集計から除外しますか？`)) return;
    try {
      await api(`/api/v1/entries/${entry.id}`, { method: "DELETE" });
      setNotice({ tone: "success", message: "登録を除外し、嗜好プロフィールを再集計しました。" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["entries"] }),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
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
      await api(`/api/v1/jobs/${entry.job.id}/retry`, { method: "POST" });
      setNotice({ tone: "info", message: `「${entry.title}」の解析を再実行しています。` });
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "再実行できませんでした" });
    } finally {
      setRetryingId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["entries"] });
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="CHARACTER REGISTRATION"
        title="キャラクター登録"
        description="既成、既成（カスタム）、オリジナルを登録し、キャラクター理解を確認してから嗜好解析へ進みます。"
        action={
          <button type="button" className="button button-primary" onClick={() => setFormOpen(true)}>
            ＋ キャラクターを登録
          </button>
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
      {entries.isPending && <Spinner label="登録一覧を読み込んでいます" />}
      {entries.isError && <Notice tone="danger">登録一覧を読み込めませんでした。</Notice>}
      {entries.data?.entries.length === 0 && (
        <Card>
          <EmptyState
            icon="◇"
            title="まだ登録がありません"
            action={
              <button type="button" className="button button-primary" onClick={() => setFormOpen(true)}>
                最初のキャラクターを登録
              </button>
            }
          >
            好きな理由が具体的なほど、あなた自身の言葉を強い根拠として保持できます。
          </EmptyState>
        </Card>
      )}
      <div className="entry-grid">
        {entries.data?.entries.map((entry) => (
          <Card className="entry-card" key={entry.id}>
            <button type="button" className="entry-main" onClick={() => setDetailId(entry.id)}>
              <div className={`entry-symbol ${entry.registrationType}`} aria-hidden="true">
                {entry.registrationType === "existing"
                  ? "既"
                  : entry.registrationType === "customized_existing"
                    ? "改"
                    : "創"}
              </div>
              <div>
                <span className="entry-type">{entry.subtitle}</span>
                <h2>{entry.title}</h2>
                <p>
                  {entry.registrationType === "customized_existing"
                    ? "基本像と改変差分を別々に抽出"
                    : "キャラクター像と嗜好候補を二段階で確認"}
                </p>
              </div>
            </button>
            <footer>
              <span className={`job-pill job-${entry.status}`}>{statusLabels[entry.status] ?? entry.status}</span>
              {entry.job?.errorCode && (
                <small className="danger-text">{analysisErrorLabels[entry.job.errorCode] ?? entry.job.errorCode}</small>
              )}
              <div className="entry-actions">
                <button type="button" onClick={() => setDetailId(entry.id)}>
                  内容を見る
                </button>
                {entry.status === "failed" && entry.job?.retryable && (
                  <button type="button" disabled={retryingId === entry.id} onClick={() => retry(entry)}>
                    {retryingId === entry.id ? "再実行中…" : "解析を再実行"}
                  </button>
                )}
                {reanalyzableStatuses.has(entry.status) && (
                  <button type="button" onClick={() => setReanalysisId(entry.id)}>
                    入力を見直して再分析
                  </button>
                )}
                {entry.status === "active" && (
                  <button type="button" className="danger-link" onClick={() => remove(entry)}>
                    除外
                  </button>
                )}
              </div>
            </footer>
          </Card>
        ))}
      </div>
      {formOpen && (
        <EntryFormModal
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false);
            setNotice({
              tone: "info",
              message:
                "入力を保存し、キャラクター理解の抽出を開始しました。Workers AIが利用できない場合も入力は残ります。",
            });
            void queryClient.invalidateQueries({ queryKey: ["entries"] });
          }}
        />
      )}
      {detailId && (
        <ReviewModal
          entryId={detailId}
          onClose={() => setDetailId(undefined)}
          onReanalyze={() => {
            setReanalysisId(detailId);
            setDetailId(undefined);
          }}
          onUpdated={() => {
            void queryClient.invalidateQueries({ queryKey: ["entries"] });
            void queryClient.invalidateQueries({ queryKey: ["profile"] });
          }}
        />
      )}
      {reanalysisId && (
        <ReanalysisModal
          entryId={reanalysisId}
          onClose={() => setReanalysisId(undefined)}
          onCreated={() => {
            setReanalysisId(undefined);
            setNotice({
              tone: "info",
              message: "入力を新しい履歴として保存し、キャラクター理解から再分析を開始しました。",
            });
            void queryClient.invalidateQueries({ queryKey: ["entries"] });
            void queryClient.invalidateQueries({ queryKey: ["profile"] });
          }}
        />
      )}
    </>
  );
}

function EntryFormModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggleResponseChannel = (value: ResponseChannel, selected: boolean) =>
    update(
      "responseChannels",
      selected
        ? form.responseChannels.includes(value)
          ? form.responseChannels
          : [...form.responseChannels, value]
        : form.responseChannels.filter((item) => item !== value),
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const common = {
      schemaVersion: "1" as const,
      registrationType: form.registrationType,
      characterName: form.characterName,
      preferenceContext: form.preferenceContext || undefined,
      referenceMaterial: form.referenceMaterial || undefined,
      userCharacterView: form.userCharacterView || undefined,
      preference: {
        likedReasons: form.likedReasons || undefined,
        dislikedReasons: form.dislikedReasons || undefined,
        responseChannels: form.responseChannels,
        valueStanceNote: form.valueStanceNote || undefined,
      },
    };
    const payload =
      form.registrationType === "original"
        ? { ...common, characterBasicInfo: form.characterBasicInfo }
        : form.registrationType === "existing"
          ? { ...common, workTitle: form.workTitle, mediaType: form.mediaType || undefined }
          : {
              ...common,
              workTitle: form.workTitle,
              mediaType: form.mediaType || undefined,
              representationType: form.representationType,
              customizationDescription: form.customizationDescription,
            };
    try {
      await api("/api/v1/entries", { method: "POST", idempotencyKey: idempotencyKey(), body: JSON.stringify(payload) });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登録できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="キャラクターを登録" onClose={onClose} wide>
      <form className="entry-form" onSubmit={submit}>
        <fieldset className="segmented">
          <legend>登録方法</legend>
          {(["existing", "customized_existing", "original"] as const).map((type) => (
            <button
              type="button"
              key={type}
              className={form.registrationType === type ? "active" : ""}
              onClick={() => update("registrationType", type)}
            >
              {type === "existing" ? "既成" : type === "customized_existing" ? "既成（カスタム）" : "オリジナル"}
            </button>
          ))}
        </fieldset>
        <div className="form-grid">
          {form.registrationType !== "original" && (
            <label>
              <span>
                作品名 <b>必須</b>
              </span>
              <input
                required
                maxLength={200}
                value={form.workTitle}
                onChange={(event) => update("workTitle", event.target.value)}
              />
            </label>
          )}
          <label>
            <span>
              キャラクター名 <b>必須</b>
            </span>
            <input
              required
              maxLength={200}
              value={form.characterName}
              onChange={(event) => update("characterName", event.target.value)}
            />
          </label>
          {form.registrationType !== "original" && (
            <label>
              <span>媒体・版</span>
              <input
                maxLength={100}
                value={form.mediaType}
                onChange={(event) => update("mediaType", event.target.value)}
                placeholder="アニメ版、ゲーム版など"
              />
            </label>
          )}
          {form.registrationType === "original" && (
            <label className="full">
              <span>
                キャラクター基本情報 <b>必須</b>
              </span>
              <textarea
                required
                rows={7}
                maxLength={20000}
                value={form.characterBasicInfo}
                onChange={(event) => update("characterBasicInfo", event.target.value)}
                placeholder="性格、価値観、目的、行動、他者との関係、物語上の役割など"
              />
              <small>このオリジナルキャラクターがどのような人物か分かる、基本的な設定を入力してください。</small>
            </label>
          )}
          <label className="full">
            <span>特に好きな時期・場面・状態（任意）</span>
            <input
              maxLength={2000}
              value={form.preferenceContext}
              onChange={(event) => update("preferenceContext", event.target.value)}
              placeholder="例：記憶を失っていた時期、第7話で別人格が現れている間"
            />
            <small>キャラクター全体ではなく、特定の時期や場面、状態に限って好きな場合に入力してください。</small>
          </label>
          {form.registrationType === "customized_existing" && (
            <>
              <label>
                <span>カスタムの種類</span>
                <select
                  value={form.representationType}
                  onChange={(event) =>
                    update("representationType", event.target.value as FormState["representationType"])
                  }
                >
                  <option value="user_interpretation">独自解釈</option>
                  <option value="transformative">二次創作</option>
                  <option value="alternate_setting">別設定</option>
                </select>
              </label>
              <label className="full">
                <span>
                  基本像からどう違うか <b>必須</b>
                </span>
                <textarea
                  required
                  rows={4}
                  maxLength={8000}
                  value={form.customizationDescription}
                  onChange={(event) => update("customizationDescription", event.target.value)}
                />
              </label>
            </>
          )}
          <label className="full">
            <span>解析に加えたい参考情報（任意）</span>
            <textarea
              rows={7}
              maxLength={20000}
              value={form.referenceMaterial}
              onChange={(event) => update("referenceMaterial", event.target.value)}
              placeholder={
                form.registrationType === "customized_existing"
                  ? "例：改変前の公式設定や人物像について、解析に加えたい情報"
                  : form.registrationType === "original"
                    ? "例：基本情報とは別に参照させたい設定メモや補足資料"
                    : "例：公式プロフィールや作中描写について、解析に加えたい情報"
              }
            />
            <small>
              {form.registrationType === "original"
                ? "基本情報に加えて参照させたい資料がある場合に入力してください。"
                : "未入力でも、作品名とキャラクター名をもとにシステムが基本情報を調べます。資料がある場合は補足として入力してください。"}
            </small>
          </label>
          <label className="full">
            <span>あなた自身のキャラクター解釈</span>
            <textarea
              rows={3}
              maxLength={4000}
              value={form.userCharacterView}
              onChange={(event) => update("userCharacterView", event.target.value)}
            />
          </label>
          <label className="full">
            <span>好きな理由</span>
            <textarea
              rows={4}
              maxLength={4000}
              value={form.likedReasons}
              onChange={(event) => update("likedReasons", event.target.value)}
              placeholder="例：言葉遣い、考え方、人間関係、特定の場面での振る舞い"
            />
          </label>
          <label className="full">
            <span>苦手な要素・このキャラで好きではない点</span>
            <textarea
              rows={3}
              maxLength={4000}
              value={form.dislikedReasons}
              onChange={(event) => update("dislikedReasons", event.target.value)}
            />
          </label>
          <ResponseChannelPicker selected={form.responseChannels} onChange={toggleResponseChannel} />
          <label className="full">
            <span>善悪・価値観について残したいニュアンス</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.valueStanceNote}
              onChange={(event) => update("valueStanceNote", event.target.value)}
              placeholder="例：このキャラクターの価値観や行動を、好きな理由としてどう捉えているか"
            />
          </label>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存して理解抽出を開始"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResponseChannelOption({
  option,
  selected,
  onChange,
}: {
  option: (typeof responseChannelCatalog)[number];
  selected: boolean;
  onChange(value: ResponseChannel, selected: boolean): void;
}) {
  return (
    <label className="check-row channel-option">
      <input type="checkbox" checked={selected} onChange={(event) => onChange(option.value, event.target.checked)} />
      <span className="channel-option-copy">
        <b>{option.label}</b>
        <small>{option.description}</small>
      </span>
    </label>
  );
}

function ResponseChannelPicker({
  selected,
  onChange,
}: {
  selected: ResponseChannel[];
  onChange(value: ResponseChannel, selected: boolean): void;
}) {
  return (
    <fieldset className="full channel-picker">
      <legend>どういう意味で好きか</legend>
      <p className="channel-picker-intro">当てはまるものを複数選べます。よく使われる項目を先に表示しています。</p>
      <div className="channel-grid">
        {popularChannelOptions.map((option) => (
          <ResponseChannelOption
            key={option.value}
            option={option}
            selected={selected.includes(option.value)}
            onChange={onChange}
          />
        ))}
      </div>
      <div className="channel-accordions">
        {responseChannelCategories.map((category) => {
          const options = detailedChannelOptions.filter((item) => item.category === category.key);
          const selectedCount = options.filter((item) => selected.includes(item.value)).length;
          return (
            <details className="channel-accordion" key={category.key}>
              <summary>
                <span>
                  <b>{category.label}</b>
                  <small>{category.description}</small>
                </span>
                <span className="channel-accordion-count">
                  {selectedCount ? `${selectedCount}件選択` : "詳細を表示"}
                </span>
              </summary>
              <div className="channel-grid channel-detail-grid">
                {options.map((option) => (
                  <ResponseChannelOption
                    key={option.value}
                    option={option}
                    selected={selected.includes(option.value)}
                    onChange={onChange}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </fieldset>
  );
}

type ReanalysisFormState = {
  likedReasons: string;
  dislikedReasons: string;
  responseChannels: ResponseChannel[];
  valueStanceNote: string;
};

function ReanalysisModal({ entryId, onClose, onCreated }: { entryId: string; onClose(): void; onCreated(): void }) {
  const detail = useQuery({
    queryKey: ["entry", entryId],
    queryFn: () => api<ReviewDetail>(`/api/v1/entries/${entryId}`),
  });
  return (
    <Modal title="入力を見直して再分析" onClose={onClose} wide>
      {detail.isPending && <Spinner label="現在の入力を読み込んでいます" />}
      {detail.isError && <Notice tone="danger">現在の入力を読み込めませんでした。</Notice>}
      {detail.data && (
        <ReanalysisForm entryId={entryId} draft={detail.data.entry.draft} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  );
}

function ReanalysisForm({
  entryId,
  draft,
  onClose,
  onCreated,
}: {
  entryId: string;
  draft: EntryDraft;
  onClose(): void;
  onCreated(): void;
}) {
  const [form, setForm] = useState<ReanalysisFormState>({
    likedReasons: draft.preference.likedReasons ?? "",
    dislikedReasons: draft.preference.dislikedReasons ?? "",
    responseChannels: draft.preference.responseChannels,
    valueStanceNote: draft.preference.valueStanceNote ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const toggleResponseChannel = (value: ResponseChannel, selected: boolean) =>
    setForm((current) => ({
      ...current,
      responseChannels: selected
        ? current.responseChannels.includes(value)
          ? current.responseChannels
          : [...current.responseChannels, value]
        : current.responseChannels.filter((item) => item !== value),
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await api(`/api/v1/entries/${entryId}/reanalysis`, {
        method: "POST",
        body: JSON.stringify({
          preference: {
            likedReasons: form.likedReasons || undefined,
            dislikedReasons: form.dislikedReasons || undefined,
            responseChannels: form.responseChannels,
            valueStanceNote: form.valueStanceNote || undefined,
          },
        }),
      });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "再分析を開始できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <Notice tone="warning">
        現在の解析履歴は残ります。再分析を始めると、新しい結果を確認するまでこの登録は累積プロフィールの集計対象外になります。
      </Notice>
      <div className="form-grid">
        <label className="full">
          <span>好きな理由</span>
          <textarea
            rows={5}
            maxLength={4000}
            value={form.likedReasons}
            onChange={(event) => setForm((current) => ({ ...current, likedReasons: event.target.value }))}
            placeholder="思い出した理由や、分析結果へ反映したい具体的な点を入力してください"
          />
        </label>
        <label className="full">
          <span>苦手な要素・このキャラで好きではない点</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={form.dislikedReasons}
            onChange={(event) => setForm((current) => ({ ...current, dislikedReasons: event.target.value }))}
          />
        </label>
        <ResponseChannelPicker selected={form.responseChannels} onChange={toggleResponseChannel} />
        <label className="full">
          <span>善悪・価値観について残したいニュアンス</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={form.valueStanceNote}
            onChange={(event) => setForm((current) => ({ ...current, valueStanceNote: event.target.value }))}
          />
        </label>
      </div>
      <small>入力を変更せず、現在の内容でもう一度分析することもできます。</small>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="modal-actions">
        <button type="button" className="button button-ghost" onClick={onClose}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? "開始中…" : "入力を保存して再分析"}
        </button>
      </div>
    </form>
  );
}

function ReviewModal({
  entryId,
  onClose,
  onUpdated,
  onReanalyze,
}: {
  entryId: string;
  onClose(): void;
  onUpdated(): void;
  onReanalyze(): void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const detail = useQuery({
    queryKey: ["entry", entryId],
    queryFn: () => api<ReviewDetail>(`/api/v1/entries/${entryId}`),
    refetchInterval: (query) =>
      ["submitted", "understanding", "analyzing"].includes(query.state.data?.entry.status ?? "") ? 2_000 : false,
  });
  async function confirm(kind: "understanding" | "preference") {
    const targetId = kind === "understanding" ? detail.data?.understanding?.id : detail.data?.preferenceAnalysis?.id;
    if (!targetId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api(`/api/v1/entries/${entryId}/${kind}-review`, {
        method: "POST",
        body: JSON.stringify({ decision: "confirm_all", targetIds: [targetId] }),
      });
      await detail.refetch();
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "確認を保存できませんでした");
    } finally {
      setSubmitting(false);
    }
  }
  const value = detail.data;
  return (
    <Modal title="解析内容の確認" onClose={onClose} wide>
      {detail.isPending && <Spinner />}
      {detail.isError && <Notice tone="danger">内容を読み込めませんでした。</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {value && (
        <div className="review-stack">
          <Notice tone={value.entry.status === "failed" ? "danger" : "info"}>
            現在: {statusLabels[value.entry.status] ?? value.entry.status}
          </Notice>
          {reanalyzableStatuses.has(value.entry.status) && (
            <button type="button" className="button button-secondary" onClick={onReanalyze}>
              入力を見直して再分析
            </button>
          )}
          {value.baseUnderstanding && (
            <Card>
              <p className="eyebrow">BASE CHARACTER UNDERSTANDING</p>
              <h3>既成キャラクターの基本像</h3>
              <p>{String(value.baseUnderstanding.summary.identity ?? "")}</p>
              <dl className="review-summary">
                {Object.entries(value.baseUnderstanding.summary)
                  .filter(([key]) => key !== "identity")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(item) ? item.join("、") || "—" : item}</dd>
                    </div>
                  ))}
              </dl>
              <h4>基本像の抽出属性</h4>
              <div className="assertion-list">
                {value.baseUnderstanding.assertions.map((item) => (
                  <span key={item.id}>
                    <strong>{item.raw_label}</strong>
                    <small>
                      {item.value_text}・確信度 {Math.round(item.confidence * 100)}%
                    </small>
                  </span>
                ))}
              </div>
            </Card>
          )}
          {value.understanding && (
            <Card>
              <p className="eyebrow">CHARACTER UNDERSTANDING</p>
              <h3>{value.baseUnderstanding ? "対象像・基本像からの差分" : "キャラクター像"}</h3>
              <p>{String(value.understanding.summary.identity ?? "")}</p>
              <dl className="review-summary">
                {Object.entries(value.understanding.summary)
                  .filter(([key]) => key !== "identity")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(item) ? item.join("、") || "—" : item}</dd>
                    </div>
                  ))}
              </dl>
              <h4>抽出属性</h4>
              <div className="assertion-list">
                {value.understanding.assertions.map((item) => (
                  <span key={item.id}>
                    <strong>{item.raw_label}</strong>
                    <small>
                      {item.value_text}・確信度 {Math.round(item.confidence * 100)}%
                    </small>
                  </span>
                ))}
              </div>
              {value.understanding.deltas.length > 0 && (
                <>
                  <h4>基本像からの差分</h4>
                  <div className="assertion-list">
                    {value.understanding.deltas.map((item) => (
                      <span key={item.id}>
                        <strong>{item.operation}</strong>
                        <small>
                          {item.before_value ?? "（追加）"} → {item.after_value ?? "（除外）"}
                        </small>
                      </span>
                    ))}
                  </div>
                </>
              )}
              {value.entry.status === "understanding_review" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={submitting}
                  onClick={() => confirm("understanding")}
                >
                  この理解を確認して嗜好解析へ
                </button>
              )}
            </Card>
          )}
          {value.preferenceAnalysis && (
            <Card>
              <p className="eyebrow">PREFERENCE CANDIDATES</p>
              <h3>この登録から読み取った「好き」</h3>
              <div className="assertion-list">
                {value.preferenceAnalysis.assertions.map((item) => (
                  <span key={item.id} className={item.polarity === "negative" ? "negative" : ""}>
                    <strong>{item.raw_label}</strong>
                    <small>
                      {item.response_channel}・強さ {Math.round(item.strength * 100)}%・{item.explicitness}
                    </small>
                  </span>
                ))}
              </div>
              {value.preferenceAnalysis.valueStances.length > 0 && (
                <>
                  <h4>価値スタンス</h4>
                  <div className="assertion-list">
                    {value.preferenceAnalysis.valueStances.map((item) => (
                      <span key={item.id}>
                        <strong>{item.target_ref}</strong>
                        <small>
                          {item.orientation} / {item.stance}
                        </small>
                      </span>
                    ))}
                  </div>
                </>
              )}
              {value.entry.status === "analysis_review" && (
                <>
                  <Notice tone="info">確認後に累積プロフィールへ反映します。</Notice>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={submitting}
                    onClick={() => confirm("preference")}
                  >
                    すべて確認してプロフィールへ反映
                  </button>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}
