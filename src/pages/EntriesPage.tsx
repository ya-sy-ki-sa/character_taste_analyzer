import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { EntrySummary, RegistrationType, ResponseChannel } from "../../shared/schemas";
import { api, idempotencyKey } from "../api";
import { Card, EmptyState, Modal, Notice, PageHeading, Spinner } from "../components/Ui";

type EntryList = { entries: EntrySummary[] };
type ReviewDetail = {
  entry: { id: string; status: string; registrationType: RegistrationType; draft: Record<string, unknown> };
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
  knownScope: string;
  sourceText: string;
  userCharacterView: string;
  representationType: "facet" | "scene_state" | "alternate_setting" | "transformative" | "user_interpretation";
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
  knownScope: "作品全体の基本像",
  sourceText: "",
  userCharacterView: "",
  representationType: "facet",
  customizationDescription: "",
  likedReasons: "",
  dislikedReasons: "",
  responseChannels: ["person_liking"],
  valueStanceNote: "",
};

const channelOptions: Array<[ResponseChannel, string]> = [
  ["person_liking", "人物として好き"],
  ["aesthetic_liking", "見た目・声・演技が好き"],
  ["narrative_interest", "物語を面白くする"],
  ["fascination_with_transgression", "逸脱に惹かれる"],
  ["root_for", "勝ってほしい"],
  ["love_to_hate", "嫌いも含めて楽しい"],
  ["desire_no_redemption", "改心せずにいてほしい"],
  ["empathy", "共感する"],
  ["admiration", "憧れる"],
  ["curiosity", "観察したい"],
];

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

export function EntriesPage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string>();
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
      <Notice tone="info">
        ヴィラン、非道徳、善への無関心、端役、一場面限定、二次創作も、そのまま有効な「好き」として記録します。
      </Notice>
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
              {entry.job?.errorCode && <small className="danger-text">{entry.job.errorCode}</small>}
              <div className="entry-actions">
                <button type="button" onClick={() => setDetailId(entry.id)}>
                  内容を見る
                </button>
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
          onUpdated={() => {
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const common = {
      schemaVersion: "1" as const,
      registrationType: form.registrationType,
      characterName: form.characterName,
      knownScope: form.knownScope,
      sourceText: form.sourceText,
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
        ? common
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
          <label className="full">
            <span>
              今回どの範囲を指すか <b>必須</b>
            </span>
            <input
              required
              maxLength={2000}
              value={form.knownScope}
              onChange={(event) => update("knownScope", event.target.value)}
              placeholder="作品全体、第3話の場面、裏人格だけ、など"
            />
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
                  <option value="facet">一面・人格</option>
                  <option value="scene_state">一場面限定</option>
                  <option value="alternate_setting">別設定</option>
                  <option value="transformative">二次創作での改変</option>
                  <option value="user_interpretation">独自解釈</option>
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
            <span>
              {form.registrationType === "customized_existing"
                ? "基本キャラクターを判断できる資料・説明"
                : "キャラクターを判断できる資料・説明"}{" "}
              <b>必須</b>
            </span>
            <textarea
              required
              rows={7}
              maxLength={20000}
              value={form.sourceText}
              onChange={(event) => update("sourceText", event.target.value)}
              placeholder={
                form.registrationType === "customized_existing"
                  ? "改変前の基本像について、設定、行動、役割、価値観などを入力。変更点は上の差分欄へ分けます。"
                  : "設定、行動、作中での役割、価値観、印象的な場面など。入力範囲外は補完しません。"
              }
            />
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
              placeholder="例：純粋な悪として改心しないところ、端役なのに一場面で空気を変えるところ"
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
          <fieldset className="full channel-grid">
            <legend>どういう意味で好きか</legend>
            {channelOptions.map(([value, label]) => (
              <label className="check-row" key={value}>
                <input
                  type="checkbox"
                  checked={form.responseChannels.includes(value)}
                  onChange={(event) =>
                    update(
                      "responseChannels",
                      event.target.checked
                        ? [...form.responseChannels, value]
                        : form.responseChannels.filter((item) => item !== value),
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className="full">
            <span>善悪・価値観について残したいニュアンス</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.valueStanceNote}
              onChange={(event) => update("valueStanceNote", event.target.value)}
              placeholder="例：悪役としての行為を穏当化せず、悪そのものを肯定する姿勢が好き。現実で支持するという意味ではない。"
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

function ReviewModal({ entryId, onClose, onUpdated }: { entryId: string; onClose(): void; onUpdated(): void }) {
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
                  <Notice tone="info">
                    確認後に累積プロフィールへ反映します。善悪や役割による評価の上下は行いません。
                  </Notice>
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
