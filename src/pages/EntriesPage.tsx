import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { type DarkResponseChannel, darkResponseChannelCatalog } from "../../shared/dark-response-channels";
import {
  responseChannelCatalog,
  responseChannelCategories,
  responseChannelLabel,
} from "../../shared/response-channels";
import {
  type AnyEntryDraft,
  type AnyEntrySubmission,
  canonicalEntryInputPointer,
  type DarkContext,
  type EntrySummary,
  entryBaseCharacterName,
  entryPreferenceContext,
  entryReferenceMaterial,
  type IdentityCandidate,
  type IdentityResolution,
  type PreferenceReviewMutation,
  type RegistrationType,
  type ResponseChannel,
  type UnderstandingReviewMutation,
} from "../../shared/schemas";
import { valueOrientationLabel, valueStanceLabel } from "../../shared/value-stance-labels";
import { api, idempotencyKey } from "../api";
import { Card, EmptyState, Modal, Notice, PageHeading, Spinner } from "../components/Ui";
import { evidenceQuoteLabel, explicitnessLabel } from "../lib/analysis-labels";
import { buildCharacterMarkdown, characterMarkdownFilename } from "../lib/entry-markdown";
import { groupPreferenceAssertions, normalizePreferenceLabel } from "../lib/preference-assertion-groups";

type EntryList = { entries: EntrySummary[] };
type EvidenceDetail = {
  id: string;
  verificationStatus: string;
  inferenceType: string;
  quote: string | null;
  inputPointer: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceProvider: string | null;
  trustReason: string | null;
  canNavigate: boolean;
};
type CustomizationDeltaDetail = {
  id: string;
  operation: string;
  before_value: string | null;
  after_value: string | null;
  reason_text: string | null;
  confidence: number;
  status: string;
};
type CharacterAssertionDetail = {
  id: string;
  raw_label: string;
  value_text: string;
  explicitness: string;
  confidence: number;
  status: string;
  evidence: EvidenceDetail[];
  stable_key: string | null;
};

const evidenceSourceProviderLabels: Record<string, string> = {
  wikipedia_ja: "日本語Wikipedia",
  wikidata: "Wikidata",
  openai_web_search: "OpenAI Web Search",
};
type ReviewDetail = {
  entry: { id: string; status: string; registrationType: RegistrationType; draft: AnyEntryDraft };
  darkScopeAssessment: null | {
    id: string;
    verdict: string;
    status: string;
    assessment: { rationale: string; limitations: string[]; recommendedQuestions: string[] };
  };
  darkBaseline: null | ({ id: string } & Record<string, unknown>);
  darkTransformationDeltas: Array<{
    id: string;
    operation: string;
    aspect: string;
    before_value: string | null;
    after_value: string | null;
    confidence: number;
    detail: Record<string, unknown>;
  }>;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  understanding: null | {
    id: string;
    sourceAssessment: { coverage: string; limitations: string[] };
    summary: Record<string, string | string[]>;
    uncertainties: Array<{ topic: string; reason: string }>;
    confidence: number;
    assertions: CharacterAssertionDetail[];
    deltas: CustomizationDeltaDetail[];
  };
  baseUnderstanding: null | {
    id: string;
    sourceAssessment: { coverage: string; limitations: string[] };
    summary: Record<string, string | string[]>;
    uncertainties: Array<{ topic: string; reason: string }>;
    confidence: number;
    assertions: CharacterAssertionDetail[];
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
      stable_key: string | null;
      evidence: EvidenceDetail[];
    }>;
    valueStances: Array<{
      id: string;
      target_ref: string;
      stance: string;
      orientation: string;
      explicitness: string;
      confidence: number;
      status: string;
      evidence: EvidenceDetail[];
    }>;
  };
};

type FormState = {
  registrationType: RegistrationType;
  workTitle: string;
  baseCharacterName: string;
  characterName: string;
  mediaType: string;
  preferenceContext: string;
  characterBasicInfo: string;
  referenceMaterial: string;
  userCharacterView: string;
  representationType: "facet" | "scene_state" | "user_interpretation" | "transformative" | "alternate_setting";
  customizationDescription: string;
  likedReasons: string;
  dislikedReasons: string;
  responseChannels: Array<ResponseChannel | DarkResponseChannel>;
  valueStanceNote: string;
  focusDescription: string;
  archetypeHints: DarkContext["archetypeHints"];
  beforeState: string;
  transitionTrigger: string;
  controllerOrInfluence: string;
  controlMechanism: string;
  awarenessAndResistance: string;
  relationshipChange: string;
  responsibilityNote: string;
  desiredOutcome: string;
  contentBoundaries: string;
};

const understandingSummaryLabels: Record<string, string> = {
  narrativeRole: "物語での役割",
  moralityOrientation: "善悪・道徳的な傾向",
  goals: "目的・目標",
  values: "重視する価値観",
  behavior: "行動・振る舞い",
  relationships: "他者との関係",
  expression: "表現・雰囲気",
  darkState: "主体性・支配構造",
  auditNotes: "整合性監査メモ",
};

const darkStateLabels: Record<string, string> = {
  agencyOrigin: "主体性の由来",
  consent: "同意",
  awareness: "認識",
  resistance: "抵抗",
  identityContinuity: "自我連続性",
  responsibility: "責任帰属",
  reversibility: "可逆性",
  controllerOrInfluence: "支配者・影響源",
  mechanism: "機構",
  before: "変化前",
  onset: "発生",
  activeState: "闇状態",
  recoveryOrAfter: "回復後・その後",
};

function understandingSummaryLabel(key: string): string {
  return understandingSummaryLabels[key] ?? "その他の特徴";
}

function reviewSummaryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("、") || "—";
  if (value && typeof value === "object")
    return (
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== "")
        .map(([key, item]) => `${darkStateLabels[key] ?? key}: ${String(item)}`)
        .join(" ／ ") || "—"
    );
  return String(value ?? "—");
}

function emptyForm(domain: AnalysisDomain): FormState {
  return {
    registrationType: "existing",
    workTitle: "",
    baseCharacterName: "",
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
    responseChannels: domain === "dark" ? ["dark_character_liking"] : ["person_liking"],
    valueStanceNote: "",
    focusDescription: "",
    archetypeHints: [],
    beforeState: "",
    transitionTrigger: "",
    controllerOrInfluence: "",
    controlMechanism: "",
    awarenessAndResistance: "",
    relationshipChange: "",
    responsibilityNote: "",
    desiredOutcome: "",
    contentBoundaries: "",
  };
}

function formStateFromDraft(draft: AnyEntryDraft): FormState {
  return {
    registrationType: draft.registrationType,
    workTitle: draft.registrationType === "original" ? "" : draft.workTitle,
    baseCharacterName: draft.registrationType === "customized_existing" ? entryBaseCharacterName(draft) : "",
    characterName: draft.characterName,
    mediaType: draft.registrationType === "original" ? "" : (draft.mediaType ?? ""),
    preferenceContext: entryPreferenceContext(draft) ?? "",
    characterBasicInfo: draft.registrationType === "original" ? draft.characterBasicInfo : "",
    referenceMaterial: entryReferenceMaterial(draft) ?? "",
    userCharacterView: draft.userCharacterView ?? "",
    representationType:
      draft.registrationType === "customized_existing" ? draft.representationType : "user_interpretation",
    customizationDescription: draft.registrationType === "customized_existing" ? draft.customizationDescription : "",
    likedReasons: draft.preference.likedReasons ?? "",
    dislikedReasons: draft.preference.dislikedReasons ?? "",
    responseChannels: draft.preference.responseChannels,
    valueStanceNote: draft.preference.valueStanceNote ?? "",
    focusDescription: "darkContext" in draft ? draft.darkContext.focusDescription : "",
    archetypeHints: "darkContext" in draft ? draft.darkContext.archetypeHints : [],
    beforeState: "darkContext" in draft ? (draft.darkContext.beforeState ?? "") : "",
    transitionTrigger: "darkContext" in draft ? (draft.darkContext.transitionTrigger ?? "") : "",
    controllerOrInfluence: "darkContext" in draft ? (draft.darkContext.controllerOrInfluence ?? "") : "",
    controlMechanism: "darkContext" in draft ? (draft.darkContext.controlMechanism ?? "") : "",
    awarenessAndResistance: "darkContext" in draft ? (draft.darkContext.awarenessAndResistance ?? "") : "",
    relationshipChange: "darkContext" in draft ? (draft.darkContext.relationshipChange ?? "") : "",
    responsibilityNote: "darkContext" in draft ? (draft.darkContext.responsibilityNote ?? "") : "",
    desiredOutcome: "darkContext" in draft ? (draft.darkContext.desiredOutcome ?? "") : "",
    contentBoundaries: "darkContext" in draft ? (draft.darkContext.contentBoundaries ?? "") : "",
  };
}

function entrySubmissionFromForm(
  form: FormState,
  identityResolution: IdentityResolution,
  domain: AnalysisDomain,
): AnyEntrySubmission {
  const common = {
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
  const domainFields =
    domain === "dark"
      ? {
          darkContext: {
            focusDescription: form.focusDescription,
            archetypeHints: form.archetypeHints,
            beforeState: form.beforeState || undefined,
            transitionTrigger: form.transitionTrigger || undefined,
            controllerOrInfluence: form.controllerOrInfluence || undefined,
            controlMechanism: form.controlMechanism || undefined,
            awarenessAndResistance: form.awarenessAndResistance || undefined,
            relationshipChange: form.relationshipChange || undefined,
            responsibilityNote: form.responsibilityNote || undefined,
            desiredOutcome: form.desiredOutcome || undefined,
            contentBoundaries: form.contentBoundaries || undefined,
          },
        }
      : {};
  if (form.registrationType === "original")
    return {
      ...common,
      ...domainFields,
      registrationType: "original",
      characterBasicInfo: form.characterBasicInfo,
    } as AnyEntrySubmission;
  if (form.registrationType === "existing")
    return {
      ...common,
      ...domainFields,
      registrationType: "existing",
      workTitle: form.workTitle,
      mediaType: form.mediaType || undefined,
      identityResolution,
    } as AnyEntrySubmission;
  return {
    ...common,
    ...domainFields,
    registrationType: "customized_existing",
    workTitle: form.workTitle,
    baseCharacterName: form.baseCharacterName,
    mediaType: form.mediaType || undefined,
    representationType: form.representationType,
    customizationDescription: form.customizationDescription,
    identityResolution,
  } as AnyEntrySubmission;
}

function identityCharacterName(form: FormState): string {
  return form.registrationType === "customized_existing" ? form.baseCharacterName : form.characterName;
}

const popularChannelOptions = responseChannelCatalog.filter((item) => item.tier === "popular");
const detailedChannelOptions = responseChannelCatalog.filter((item) => item.tier === "detail");

const statusLabels: Record<string, string> = {
  submitted: "理解を解析中",
  understanding: "理解を解析中",
  understanding_review: "基本像の確認待ち",
  analyzing: "好みを解析中",
  analysis_review: "好みの候補の確認待ち",
  active: "解析済み",
  failed: "解析エラー",
  archived: "除外済み",
};

const analysisErrorLabels: Record<string, string> = {
  LLM_SCHEMA_INVALID: "LLMの応答形式が解析仕様を満たしませんでした",
  EXTERNAL_PROVIDER_REJECTED: "LLMサービスが解析リクエストを受け付けませんでした",
  EXTERNAL_PROVIDER_REFUSED: "LLMサービスが回答を拒否しました",
  EXTERNAL_PROVIDER_INCOMPLETE: "LLMサービスの回答が未完了でした",
  EXTERNAL_PROVIDER_UNAVAILABLE: "LLMサービスへ接続できませんでした",
  PROVIDER_CAPACITY_EXHAUSTED: "LLMサービスの利用上限または処理容量に達しました",
  EXTERNAL_PROVIDER_INVALID_RESPONSE: "LLMサービスから有効な応答を取得できませんでした",
  EXTERNAL_CITATION_NOT_ALLOWED: "LLMの回答に確認できない外部出典が含まれていました",
  EVIDENCE_SOURCE_INVALID: "LLMの回答に確認できない根拠が含まれていました",
  PREFERENCE_ANALYSIS_EMPTY: "好みの候補を生成できませんでした",
  JOB_ATTEMPT_SCOPE_REPAIRED: "解析を再実行してください",
};

const analysisErrorFallbackDetails: Record<string, string> = {
  EXTERNAL_CITATION_NOT_ALLOWED:
    "LLMの構造化応答は取得できましたが、回答内の参照URLがWeb Search注釈・収集済み出典と一致しなかったため、本システムが根拠としての採用を拒否しました。このエラー自体はOpenAIの拒否やセンシティブ判定を示しません。",
};

function analysisErrorDetail(code: string, detail: string | null): string {
  if (detail && detail !== code) return detail;
  return analysisErrorFallbackDetails[code] ?? "LLMから詳細情報を取得できませんでした。再実行すると詳細を記録します。";
}

const reanalyzableStatuses = new Set(["understanding_review", "analysis_review", "active", "failed"]);

export function EntriesPage({ domain }: { domain: AnalysisDomain }) {
  const dark = domain === "dark";
  const apiBase = dark ? "/api/v1/dark" : "/api/v1";
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string>();
  const [reanalysisId, setReanalysisId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [downloadingId, setDownloadingId] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; message: string }>();
  const entries = useQuery({
    queryKey: ["entries", domain],
    queryFn: () => api<EntryList>(`${apiBase}/entries`),
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
      await api(`${apiBase}/entries/${entry.id}`, { method: "DELETE" });
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
      await api(`${apiBase}/jobs/${entry.job.id}/retry`, { method: "POST" });
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
      const detail = await api<ReviewDetail>(`${apiBase}/entries/${entry.id}`);
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

  return (
    <>
      <PageHeading
        eyebrow={dark ? "DARK CHARACTER REGISTRATION" : "CHARACTER REGISTRATION"}
        title={dark ? "ダークキャラクター登録" : "キャラクター登録"}
        description={
          dark
            ? "注目する悪・支配・堕落・敵対状態を登録し、専用の多段解析と確認へ進みます。"
            : "既成、既成（カスタム）、オリジナルを登録し、キャラクター理解を確認してから好み分析へ進みます。"
        }
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
                    : "キャラクター像と好みの候補を二段階で確認"}
                </p>
              </div>
            </button>
            <footer>
              <span className={`job-pill job-${entry.status}`}>{statusLabels[entry.status] ?? "状態を確認中"}</span>
              {entry.job?.errorCode && (
                <div className="analysis-error-detail" role="alert">
                  <strong>{analysisErrorLabels[entry.job.errorCode] ?? "解析中にエラーが発生しました"}</strong>
                  <span>
                    <b>エラー詳細</b>
                    {analysisErrorDetail(entry.job.errorCode, entry.job.errorDetail)}
                  </span>
                </div>
              )}
              <div className="entry-actions">
                <button type="button" onClick={() => setDetailId(entry.id)}>
                  内容を見る
                </button>
                <button
                  type="button"
                  disabled={downloadingId === entry.id}
                  onClick={() => void downloadCharacterInformation(entry)}
                >
                  {downloadingId === entry.id ? "Markdownを作成中…" : "登録情報をMarkdownで保存"}
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
                {["active", "failed"].includes(entry.status) && (
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
          domain={domain}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false);
            setNotice({
              tone: "info",
              message:
                "入力を保存し、キャラクター理解の抽出を開始しました。Workers AIが利用できない場合も入力は残ります。",
            });
            void queryClient.invalidateQueries({ queryKey: ["entries", domain] });
          }}
        />
      )}
      {detailId && (
        <ReviewModal
          domain={domain}
          entryId={detailId}
          onClose={() => setDetailId(undefined)}
          onReanalyze={() => {
            setReanalysisId(detailId);
            setDetailId(undefined);
          }}
          onUpdated={() => {
            void queryClient.invalidateQueries({ queryKey: ["entries", domain] });
            void queryClient.invalidateQueries({ queryKey: ["profile", domain] });
          }}
        />
      )}
      {reanalysisId && (
        <ReanalysisModal
          domain={domain}
          entryId={reanalysisId}
          onClose={() => setReanalysisId(undefined)}
          onCreated={() => {
            setReanalysisId(undefined);
            setNotice({
              tone: "info",
              message: "入力を新しい履歴として保存し、キャラクター理解から再分析を開始しました。",
            });
            void queryClient.invalidateQueries({ queryKey: ["entries", domain] });
            void queryClient.invalidateQueries({ queryKey: ["profile", domain] });
          }}
        />
      )}
    </>
  );
}

function EntryFormModal({
  domain,
  onClose,
  onCreated,
}: {
  domain: AnalysisDomain;
  onClose(): void;
  onCreated(): void;
}) {
  const apiBase = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const [form, setForm] = useState<FormState>(() => emptyForm(domain));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [candidates, setCandidates] = useState<IdentityCandidate[]>();
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("new");
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (["registrationType", "workTitle", "baseCharacterName", "characterName", "mediaType"].includes(key)) {
      setCandidates(undefined);
      setSelectedIdentityId("new");
    }
  };
  const toggleResponseChannel = (value: ResponseChannel | DarkResponseChannel, selected: boolean) =>
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
    let resolvedCandidates = candidates;
    let resolvedIdentityId = selectedIdentityId;
    if (form.registrationType !== "original" && candidates === undefined) {
      try {
        const result = await api<{ candidates: IdentityCandidate[] }>(`${apiBase}/identity-candidates`, {
          method: "POST",
          body: JSON.stringify({
            workTitle: form.workTitle,
            characterName: identityCharacterName(form),
            mediaType: form.mediaType || undefined,
          }),
        });
        setCandidates(result.candidates);
        setSelectedIdentityId(result.candidates.length ? "" : "new");
        resolvedCandidates = result.candidates;
        resolvedIdentityId = result.candidates.length ? "" : "new";
        if (result.candidates.length) return;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "同一キャラクター候補を確認できませんでした");
        return;
      } finally {
        setSubmitting(false);
      }
    }
    if (form.registrationType !== "original" && !resolvedIdentityId) {
      setError("既存の同一人物情報を再利用するか、別物として新規登録するか選んでください");
      setSubmitting(false);
      return;
    }
    const selectedCandidate = resolvedCandidates?.find((item) => item.characterIdentityId === resolvedIdentityId);
    const identityResolution = selectedCandidate
      ? {
          mode: "reuse" as const,
          workId: selectedCandidate.workId,
          characterIdentityId: selectedCandidate.characterIdentityId,
        }
      : { mode: "new" as const };
    const payload = entrySubmissionFromForm(form, identityResolution, domain);
    try {
      await api(`${apiBase}/entries`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify(payload),
      });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登録できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={domain === "dark" ? "ダークキャラクターを登録" : "キャラクターを登録"} onClose={onClose} wide>
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
          {form.registrationType === "customized_existing" && (
            <label>
              <span>
                既成キャラクター名 <b>必須</b>
              </span>
              <input
                required
                maxLength={200}
                value={form.baseCharacterName}
                onChange={(event) => update("baseCharacterName", event.target.value)}
              />
              <small>元キャラクターを特定し、「既成キャラクターの基本像」を調べるための名前です。</small>
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
            {form.registrationType === "customized_existing" && (
              <small>カスタム後のキャラクター名です。一覧や解析画面ではこちらを表示します。</small>
            )}
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
          {domain === "dark" && <DarkContextFields form={form} update={update} />}
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
                  <option value="facet">特定の側面</option>
                  <option value="scene_state">特定の場面・状態</option>
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
          <ResponseChannelPicker domain={domain} selected={form.responseChannels} onChange={toggleResponseChannel} />
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
        {form.registrationType !== "original" && candidates && candidates.length > 0 && (
          <fieldset className="identity-resolution">
            <legend>同じ作品・キャラクターの登録候補</legend>
            <p>同一人物なら既存の同一人物情報を再利用します。今回の解釈・表現はどちらを選んでも新しく保存されます。</p>
            {candidates.map((candidate) => (
              <label className="check-row" key={candidate.characterIdentityId}>
                <input
                  type="radio"
                  name="identity-resolution"
                  checked={selectedIdentityId === candidate.characterIdentityId}
                  onChange={() => setSelectedIdentityId(candidate.characterIdentityId)}
                />
                <span>
                  既存の同一人物情報を再利用：{candidate.workTitle} / {candidate.characterName}
                </span>
              </label>
            ))}
            <label className="check-row">
              <input
                type="radio"
                name="identity-resolution"
                checked={selectedIdentityId === "new"}
                onChange={() => setSelectedIdentityId("new")}
              />
              <span>同名だが別物として新規登録</span>
            </label>
          </fieldset>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting
              ? "確認中…"
              : form.registrationType !== "original" && candidates === undefined
                ? "同一キャラクター候補を確認"
                : "保存して理解抽出を開始"}
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
  option: (typeof responseChannelCatalog)[number] | (typeof darkResponseChannelCatalog)[number];
  selected: boolean;
  onChange(value: ResponseChannel | DarkResponseChannel, selected: boolean): void;
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
  domain,
  selected,
  onChange,
}: {
  domain: AnalysisDomain;
  selected: Array<ResponseChannel | DarkResponseChannel>;
  onChange(value: ResponseChannel | DarkResponseChannel, selected: boolean): void;
}) {
  if (domain === "dark")
    return (
      <fieldset className="full channel-picker dark-channel-picker">
        <legend>ダークな状態の、どこに惹かれるか</legend>
        <p className="channel-picker-intro">専用の反応経路です。人物への好意と、行為への道徳的支持は別に扱われます。</p>
        <div className="channel-grid">
          {darkResponseChannelCatalog.map((option) => (
            <ResponseChannelOption
              key={option.value}
              option={option}
              selected={selected.includes(option.value)}
              onChange={onChange}
            />
          ))}
        </div>
      </fieldset>
    );
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

const darkArchetypeOptions: Array<{ value: DarkContext["archetypeHints"][number]; label: string }> = [
  { value: "villain", label: "ヴィラン" },
  { value: "villain_protagonist", label: "ヴィラン主人公" },
  { value: "antagonistic_rival", label: "悪役ライバル" },
  { value: "antihero", label: "アンチヒーロー" },
  { value: "dark_hero", label: "ダークヒーロー" },
  { value: "morally_gray", label: "モラリー・グレー" },
  { value: "fallen_hero", label: "堕落した英雄" },
  { value: "controlled_hero", label: "支配された勇者" },
  { value: "manipulated_former_ally", label: "操作された元味方" },
  { value: "betraying_ally", label: "裏切った協力者" },
  { value: "other_dark", label: "その他のダーク状態" },
];

function DarkContextFields({
  form,
  update,
}: {
  form: FormState;
  update<K extends keyof FormState>(key: K, value: FormState[K]): void;
}) {
  return (
    <>
      <label className="full dark-focus-field">
        <span>
          注目するダーク状態・役割 <b>必須</b>
        </span>
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={form.focusDescription}
          onChange={(event) => update("focusDescription", event.target.value)}
          placeholder="例：敵に洗脳され、元の仲間へ剣を向ける間。自我と正義感は残り、内側では抵抗している"
        />
      </label>
      <fieldset className="full identity-resolution dark-archetypes">
        <legend>アーキタイプ候補（任意）</legend>
        <div className="channel-grid">
          {darkArchetypeOptions.map((option) => (
            <label className="check-row" key={option.value}>
              <input
                type="checkbox"
                checked={form.archetypeHints.includes(option.value)}
                onChange={(event) =>
                  update(
                    "archetypeHints",
                    event.target.checked
                      ? [...form.archetypeHints, option.value]
                      : form.archetypeHints.filter((item) => item !== option.value),
                  )
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {(
        [
          ["beforeState", "変化前・通常時", "元の役割、守っていたもの、主体性、関係性"],
          ["transitionTrigger", "闇化・敵対化の契機", "誘惑、敗北、契約、思想転向、洗脳開始など"],
          ["controllerOrInfluence", "支配者・影響源", "操作者、憑依者、呪い、力、思想など"],
          ["controlMechanism", "支配・変化の機構", "洗脳方法、命令、拘束、同意の有無など"],
          ["awarenessAndResistance", "認識・抵抗・自我", "本人は認識しているか、抵抗や自我は残るか"],
          ["relationshipChange", "関係の変化", "元味方、支配者、宿敵との変化前後"],
          ["responsibilityNote", "責任の捉え方", "行為の責任を本人・支配者へどう帰属させるか"],
          ["desiredOutcome", "望む結末", "回復、闇の維持・深化、無改心、勝利など"],
          ["contentBoundaries", "内容境界", "分析・生成で避けたい内容"],
        ] as const
      ).map(([key, label, placeholder]) => (
        <label className="full" key={key}>
          <span>{label}（任意）</span>
          <textarea
            rows={3}
            maxLength={
              key === "relationshipChange" || key === "beforeState" || key === "transitionTrigger" ? 4000 : 2000
            }
            value={form[key]}
            onChange={(event) => update(key, event.target.value)}
            placeholder={placeholder}
          />
        </label>
      ))}
    </>
  );
}

function ReanalysisModal({
  domain,
  entryId,
  onClose,
  onCreated,
}: {
  domain: AnalysisDomain;
  entryId: string;
  onClose(): void;
  onCreated(): void;
}) {
  const apiBase = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const detail = useQuery({
    queryKey: ["entry", domain, entryId],
    queryFn: () => api<ReviewDetail>(`${apiBase}/entries/${entryId}`),
  });
  return (
    <Modal title="入力を見直して再分析" onClose={onClose} wide>
      {detail.isPending && <Spinner label="現在の入力を読み込んでいます" />}
      {detail.isError && <Notice tone="danger">現在の入力を読み込めませんでした。</Notice>}
      {detail.data && (
        <ReanalysisForm
          domain={domain}
          entryId={entryId}
          draft={detail.data.entry.draft}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Modal>
  );
}

function ReanalysisForm({
  entryId,
  domain,
  draft,
  onClose,
  onCreated,
}: {
  entryId: string;
  domain: AnalysisDomain;
  draft: AnyEntryDraft;
  onClose(): void;
  onCreated(): void;
}) {
  const apiBase = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const [form, setForm] = useState<FormState>(() => formStateFromDraft(draft));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [candidates, setCandidates] = useState<IdentityCandidate[]>();
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("new");
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (["workTitle", "baseCharacterName", "characterName"].includes(key)) {
      setCandidates(undefined);
      setSelectedIdentityId("new");
    }
  };
  const toggleResponseChannel = (value: ResponseChannel | DarkResponseChannel, selected: boolean) =>
    update(
      "responseChannels",
      selected
        ? form.responseChannels.includes(value)
          ? form.responseChannels
          : [...form.responseChannels, value]
        : form.responseChannels.filter((item) => item !== value),
    );
  const identityChanged =
    identityCharacterName(form).trim() !== entryBaseCharacterName(draft).trim() ||
    (draft.registrationType !== "original" && form.workTitle.trim() !== draft.workTitle.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    let resolvedCandidates = candidates;
    let resolvedIdentityId = selectedIdentityId;
    if (form.registrationType !== "original" && identityChanged && candidates === undefined) {
      try {
        const result = await api<{ candidates: IdentityCandidate[] }>(`${apiBase}/identity-candidates`, {
          method: "POST",
          body: JSON.stringify({
            workTitle: form.workTitle,
            characterName: identityCharacterName(form),
            mediaType: form.mediaType || undefined,
          }),
        });
        setCandidates(result.candidates);
        setSelectedIdentityId(result.candidates.length ? "" : "new");
        resolvedCandidates = result.candidates;
        resolvedIdentityId = result.candidates.length ? "" : "new";
        if (result.candidates.length) return;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "同一キャラクター候補を確認できませんでした");
        return;
      } finally {
        setSubmitting(false);
      }
    }
    if (form.registrationType !== "original" && identityChanged && !resolvedIdentityId) {
      setError("既存の同一人物情報を再利用するか、別物として扱うか選んでください");
      setSubmitting(false);
      return;
    }
    const currentResolution: IdentityResolution =
      draft.registrationType !== "original" ? draft.identityResolution : { mode: "new" };
    const selectedCandidate = resolvedCandidates?.find((item) => item.characterIdentityId === resolvedIdentityId);
    const identityResolution: IdentityResolution = identityChanged
      ? selectedCandidate
        ? {
            mode: "reuse",
            workId: selectedCandidate.workId,
            characterIdentityId: selectedCandidate.characterIdentityId,
          }
        : { mode: "new" }
      : currentResolution;
    try {
      await api(`${apiBase}/entries/${entryId}/reanalysis`, {
        method: "POST",
        body: JSON.stringify({ draft: entrySubmissionFromForm(form, identityResolution, domain) }),
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
      <fieldset className="segmented" disabled>
        <legend>登録方法（変更できません）</legend>
        <button type="button" className="active">
          {form.registrationType === "existing"
            ? "既成"
            : form.registrationType === "customized_existing"
              ? "既成（カスタム）"
              : "オリジナル"}
        </button>
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
        {form.registrationType === "customized_existing" && (
          <label>
            <span>
              既成キャラクター名 <b>必須</b>
            </span>
            <input
              required
              maxLength={200}
              value={form.baseCharacterName}
              onChange={(event) => update("baseCharacterName", event.target.value)}
            />
            <small>元キャラクターを特定し、「既成キャラクターの基本像」を再分析するための名前です。</small>
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
          {form.registrationType === "customized_existing" && (
            <small>カスタム後の表示名です。一覧や解析画面ではこちらを表示します。</small>
          )}
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
            />
          </label>
        )}
        {domain === "dark" && <DarkContextFields form={form} update={update} />}
        <label className="full">
          <span>特に好きな時期・場面・状態（任意）</span>
          <input
            maxLength={2000}
            value={form.preferenceContext}
            onChange={(event) => update("preferenceContext", event.target.value)}
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
                <option value="user_interpretation">独自解釈</option>
                <option value="facet">特定の側面</option>
                <option value="scene_state">特定の場面・状態</option>
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
            rows={5}
            maxLength={4000}
            value={form.likedReasons}
            onChange={(event) => update("likedReasons", event.target.value)}
            placeholder="思い出した理由や、分析結果へ反映したい具体的な点を入力してください"
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
        <ResponseChannelPicker domain={domain} selected={form.responseChannels} onChange={toggleResponseChannel} />
        <label className="full">
          <span>善悪・価値観について残したいニュアンス</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={form.valueStanceNote}
            onChange={(event) => update("valueStanceNote", event.target.value)}
          />
        </label>
      </div>
      {form.registrationType !== "original" && identityChanged && candidates && candidates.length > 0 && (
        <fieldset className="identity-resolution">
          <legend>変更後の作品・キャラクターに一致する候補</legend>
          <p>同一人物なら既存の同一人物情報を再利用します。別物の場合は新規として扱います。</p>
          {candidates.map((candidate) => (
            <label className="check-row" key={candidate.characterIdentityId}>
              <input
                type="radio"
                name="reanalysis-identity-resolution"
                checked={selectedIdentityId === candidate.characterIdentityId}
                onChange={() => setSelectedIdentityId(candidate.characterIdentityId)}
              />
              <span>
                既存の同一人物情報を再利用：{candidate.workTitle} / {candidate.characterName}
              </span>
            </label>
          ))}
          <label className="check-row">
            <input
              type="radio"
              name="reanalysis-identity-resolution"
              checked={selectedIdentityId === "new"}
              onChange={() => setSelectedIdentityId("new")}
            />
            <span>別物として新規登録</span>
          </label>
        </fieldset>
      )}
      <small>入力を変更せず、現在の内容でもう一度分析することもできます。</small>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="modal-actions">
        <button type="button" className="button button-ghost" onClick={onClose}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting
            ? "確認中…"
            : form.registrationType !== "original" && identityChanged && candidates === undefined
              ? "同一キャラクター候補を確認"
              : "入力を保存して再分析"}
        </button>
      </div>
    </form>
  );
}

function ReviewModal({
  domain,
  entryId,
  onClose,
  onUpdated,
  onReanalyze,
}: {
  domain: AnalysisDomain;
  entryId: string;
  onClose(): void;
  onUpdated(): void;
  onReanalyze(): void;
}) {
  const apiBase = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const detail = useQuery({
    queryKey: ["entry", domain, entryId],
    queryFn: () => api<ReviewDetail>(`${apiBase}/entries/${entryId}`),
    refetchInterval: (query) =>
      ["submitted", "understanding", "analyzing"].includes(query.state.data?.entry.status ?? "") ? 2_000 : false,
  });
  async function confirm(kind: "understanding" | "preference") {
    const targetId = kind === "understanding" ? detail.data?.understanding?.id : detail.data?.preferenceAnalysis?.id;
    if (!targetId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api(
        kind === "understanding"
          ? `${apiBase}/understanding-snapshots/${targetId}/review`
          : `${apiBase}/preference-analysis-runs/${targetId}/review`,
        {
          method: "POST",
          body: JSON.stringify({ decision: "confirm_all", targetIds: [targetId] }),
        },
      );
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
      await api(`${apiBase}/understanding-snapshots/${snapshotId}/review`, {
        method: "POST",
        body: JSON.stringify(input),
      });
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
      await api(`${apiBase}/preference-analysis-runs/${runId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: "reject_selected", targetIds: [targetId] }),
      });
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
      await api(`${apiBase}/preference-analysis-runs/${runId}/review`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify(input),
      });
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
      await api(`${apiBase}/scope-assessments/${assessmentId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await detail.refetch();
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "対象範囲の判断を保存できませんでした");
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
            現在: {statusLabels[value.entry.status] ?? "状態を確認中"}
          </Notice>
          {value.darkScopeAssessment?.status === "proposed" && (
            <Card>
              <p className="eyebrow">DARK SCOPE REVIEW</p>
              <h3>ダークラボの対象外と判定されました</h3>
              <p>{value.darkScopeAssessment.assessment.rationale}</p>
              {value.darkScopeAssessment.assessment.limitations.map((item) => (
                <p className="muted" key={item}>
                  {item}
                </p>
              ))}
              <Notice tone="warning">
                対象とする限定状態や独自解釈が明示されている場合は、判定を上書きして続行できます。
              </Notice>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={submitting}
                  onClick={() => void reviewDarkScope("continue")}
                >
                  対象として続行
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={submitting}
                  onClick={() => void reviewDarkScope("cancel")}
                >
                  登録を取り消す
                </button>
              </div>
            </Card>
          )}
          {value.darkBaseline && (
            <Card>
              <p className="eyebrow">DARK BASELINE SNAPSHOT</p>
              <h3>ダーク化前の比較ベースライン</h3>
              <p className="section-help">通常分析器や通常の好みの属性には対応させず、差分理解だけに使います。</p>
              <dl className="review-summary">
                {Object.entries(value.darkBaseline)
                  .filter(([key]) => key !== "id" && key !== "evidence" && key !== "uncertainties")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(item) ? item.join("、") || "—" : String(item ?? "—")}</dd>
                    </div>
                  ))}
              </dl>
            </Card>
          )}
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
                      <dt>{understandingSummaryLabel(key)}</dt>
                      <dd>{reviewSummaryValue(item)}</dd>
                    </div>
                  ))}
              </dl>
              <h4>基本像の抽出属性</h4>
              {value.entry.status === "understanding_review" && (
                <p className="review-edit-guidance">
                  認識と違う項目は修正・削除でき、不足している属性は手動追加できます。保存した内容は基本像の確認結果として記録されます。
                </p>
              )}
              <div className="assertion-list">
                {value.baseUnderstanding.assertions.map((item) => (
                  <article key={item.id}>
                    <div className="assertion-card-header">
                      <div className="assertion-title">
                        <strong>{item.raw_label}</strong>
                        {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
                      </div>
                      <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                    </div>
                    <p className="assertion-value">{item.value_text}</p>
                    <EvidenceList evidence={item.evidence} />
                    {value.entry.status === "understanding_review" && (
                      <AssertionReviewControls
                        item={item}
                        ontologyAttributes={value.ontologyAttributes}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.baseUnderstanding?.id, input)}
                      />
                    )}
                  </article>
                ))}
                {value.entry.status === "understanding_review" && (
                  <AddAssertionControl
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutateUnderstandingSnapshot(value.baseUnderstanding?.id, input)}
                  />
                )}
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
                      <dt>{understandingSummaryLabel(key)}</dt>
                      <dd>{reviewSummaryValue(item)}</dd>
                    </div>
                  ))}
              </dl>
              <h4>抽出属性</h4>
              {value.entry.status === "understanding_review" && (
                <p className="review-edit-guidance">
                  認識と違う項目は修正・削除でき、不足している属性は手動追加できます。保存した内容が次の好み分析に使われます。
                </p>
              )}
              <div className="assertion-list">
                {value.understanding.assertions.map((item) => (
                  <article key={item.id}>
                    <div className="assertion-card-header">
                      <div className="assertion-title">
                        <strong>{item.raw_label}</strong>
                        {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
                      </div>
                      <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                    </div>
                    <p className="assertion-value">{item.value_text}</p>
                    <EvidenceList evidence={item.evidence} />
                    {value.entry.status === "understanding_review" && (
                      <AssertionReviewControls
                        item={item}
                        ontologyAttributes={value.ontologyAttributes}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    )}
                  </article>
                ))}
                {value.entry.status === "understanding_review" && (
                  <AddAssertionControl
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                  />
                )}
              </div>
              {(value.understanding.deltas.length > 0 ||
                (value.baseUnderstanding && value.entry.status === "understanding_review")) && (
                <>
                  <h4>原典からどのように変わっているか</h4>
                  <p className="section-help">原典の設定と、この登録で指定されたキャラクター像を比較しています。</p>
                  <div className="customization-delta-list">
                    {value.understanding.deltas.map((item) => (
                      <CustomizationDeltaCard
                        key={item.id}
                        item={item}
                        targetName={value.entry.draft.characterName}
                        editable={value.entry.status === "understanding_review"}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    ))}
                    {value.entry.status === "understanding_review" && (
                      <AddDeltaControl
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    )}
                  </div>
                </>
              )}
              {value.darkTransformationDeltas.length > 0 && (
                <>
                  <h4>ダーク化前からの専用差分</h4>
                  <p className="section-help">
                    保持・増幅・抑圧・反転・消失・追加を、主体性と責任の情報から分離して保存しています。
                  </p>
                  <div className="customization-delta-list">
                    {value.darkTransformationDeltas.map((item) => (
                      <article key={item.id} className="dark-delta-card">
                        <div className="assertion-card-header">
                          <strong>
                            {item.operation}：{item.aspect}
                          </strong>
                          <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                        </div>
                        <p>
                          {item.before_value ?? "—"} → {item.after_value ?? "—"}
                        </p>
                        <small>
                          主体性: {String(item.detail.agencyOrigin ?? "unknown")} ／ 抵抗:{" "}
                          {String(item.detail.resistance ?? "unknown")} ／ 責任:{" "}
                          {String(item.detail.responsibility ?? "unknown")}
                        </small>
                      </article>
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
                  この理解を確認して好み分析へ
                </button>
              )}
            </Card>
          )}
          {value.preferenceAnalysis && (
            <Card>
              <p className="eyebrow">PREFERENCE CANDIDATES</p>
              <h3>この登録から読み取った「好き」</h3>
              {value.entry.status === "analysis_review" && (
                <p className="review-edit-guidance">
                  認識と違う候補は個別に削除できます。削除した候補はプロフィールへ反映されません。
                </p>
              )}
              <div className="preference-attribute-list">
                {value.preferenceAnalysis.assertions.length === 0 &&
                  value.preferenceAnalysis.valueStances.length === 0 && (
                    <Notice tone="info">
                      この登録からは好みを特定できませんでした。これは正常な分析結果で、候補を追加せず確認できます。
                    </Notice>
                  )}
                {groupPreferenceAssertions(value.preferenceAnalysis.assertions).map((group) => (
                  <section className="preference-attribute-group" key={group.id}>
                    <header className="preference-attribute-header">
                      <h4>{group.label}</h4>
                      <small>惹かれ方 {group.items.length}件</small>
                    </header>
                    <div className="preference-channel-list">
                      {group.items.map((item) => {
                        const itemLabelDiffers =
                          normalizePreferenceLabel(item.raw_label) !== normalizePreferenceLabel(group.label);
                        return (
                          <article key={item.id} className={`preference-channel-item preference-${item.polarity}`}>
                            <div className="assertion-card-header">
                              <div className="preference-channel-title">
                                <strong>{responseChannelLabel(item.response_channel)}</strong>
                                <span className="preference-polarity">
                                  {item.polarity === "negative"
                                    ? "苦手・否定的"
                                    : item.polarity === "mixed"
                                      ? "好き嫌いが混在"
                                      : "好き・肯定的"}
                                </span>
                              </div>
                              <small className="confidence-pill">
                                登録内支持度 {Math.round(item.confidence * 100)}%
                              </small>
                            </div>
                            {itemLabelDiffers && (
                              <small className="preference-source-label">表現：{item.raw_label}</small>
                            )}
                            <small>
                              強さ {Math.round(item.strength * 100)}%・{explicitnessLabel(item.explicitness)}
                            </small>
                            <EvidenceList evidence={item.evidence} />
                            {value.entry.status === "analysis_review" && (
                              <div className="review-item-actions">
                                <PreferenceAssertionEditControl
                                  item={item}
                                  domain={domain}
                                  ontologyAttributes={value.ontologyAttributes}
                                  disabled={submitting}
                                  onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                                />
                                <button
                                  type="button"
                                  className="danger-link"
                                  disabled={submitting}
                                  onClick={() =>
                                    void rejectPreferenceItem(
                                      value.preferenceAnalysis?.id ?? "",
                                      item.id,
                                      `${group.label}／${responseChannelLabel(item.response_channel)}`,
                                    )
                                  }
                                >
                                  削除
                                </button>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {value.entry.status === "analysis_review" && (
                  <AddPreferenceAssertionControl
                    domain={domain}
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                  />
                )}
              </div>
              {value.preferenceAnalysis.valueStances.length > 0 && (
                <>
                  <h4>価値スタンス</h4>
                  <div className="assertion-list">
                    {value.preferenceAnalysis.valueStances.map((item) => (
                      <article key={item.id}>
                        <div className="assertion-card-header">
                          <strong>{item.target_ref}</strong>
                          <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                        </div>
                        <small>
                          対象の価値傾向：{valueOrientationLabel(item.orientation)} ／ あなたの捉え方：
                          {valueStanceLabel(item.stance)}
                        </small>
                        <EvidenceList evidence={item.evidence} />
                        {value.entry.status === "analysis_review" && (
                          <div className="review-item-actions">
                            <ValueStanceEditControl
                              item={item}
                              disabled={submitting}
                              onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                            />
                            <button
                              type="button"
                              className="danger-link"
                              disabled={submitting}
                              onClick={() =>
                                void rejectPreferenceItem(value.preferenceAnalysis?.id ?? "", item.id, item.target_ref)
                              }
                            >
                              削除
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
              {value.entry.status === "analysis_review" && (
                <AddValueStanceControl
                  disabled={submitting}
                  onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                />
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

const evidenceStatusLabels: Record<string, string> = {
  verified_quote: "原文照合済み",
  source_attributed: "出典のみ確認",
  model_knowledge: "モデル知識",
  invalid: "根拠を検証できません",
};

const deltaOperationLabels: Record<string, { label: string; description: string }> = {
  add: { label: "新しく追加された設定", description: "原典にはない設定が追加されています。" },
  modify: { label: "内容が変更された設定", description: "原典の設定が別の内容に変わっています。" },
  remove: { label: "取り除かれた設定", description: "原典にある設定が、このキャラクター像では適用されません。" },
  invert: { label: "反対になった設定", description: "原典とは反対の性質・立場へ変更されています。" },
  narrow_scope: { label: "範囲が限定された設定", description: "原典の設定が特定の場面や状態だけに限定されています。" },
  emphasize: { label: "より強調された設定", description: "原典にもある性質が、より強く表現されています。" },
  inherit: { label: "原典から引き継いだ設定", description: "原典と同じ設定が維持されています。" },
  unspecified: { label: "その他の変更", description: "登録内容から読み取った原典との差分です。" },
};

type ReviewMutationHandler = (input: UnderstandingReviewMutation) => Promise<boolean>;
type PreferenceMutationHandler = (input: PreferenceReviewMutation) => Promise<boolean>;

function PreferenceAssertionForm({
  initial,
  domain,
  ontologyAttributes,
  disabled,
  submitLabel,
  onCancel,
  onMutate,
}: {
  initial?: {
    id: string;
    raw_label: string;
    stable_key: string | null;
    polarity: string;
    response_channel: string;
    strength: number;
  };
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  submitLabel: string;
  onCancel(): void;
  onMutate: PreferenceMutationHandler;
}) {
  const channels = domain === "dark" ? darkResponseChannelCatalog : responseChannelCatalog;
  const [rawLabel, setRawLabel] = useState(initial?.raw_label ?? "");
  const [attributeStableKey, setAttributeStableKey] = useState(initial?.stable_key ?? "");
  const [polarity, setPolarity] = useState<"positive" | "negative" | "mixed">(
    initial?.polarity === "negative" || initial?.polarity === "mixed" ? initial.polarity : "positive",
  );
  const [responseChannel, setResponseChannel] = useState(initial?.response_channel ?? channels[0].value);
  const [strength, setStrength] = useState(initial?.strength ?? 0.8);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const common = {
      rawLabel,
      attributeStableKey: attributeStableKey || null,
      polarity,
      responseChannel: responseChannel as ResponseChannel | DarkResponseChannel,
      strength,
    };
    const saved = initial
      ? await onMutate({ action: "update_preference", targetId: initial.id, ...common })
      : await onMutate({ action: "add_preference", ...common });
    if (saved) onCancel();
  }
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <label>
        <span>好みの属性名</span>
        <input required maxLength={200} value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} />
      </label>
      <label>
        <span>Ontology属性</span>
        <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
          <option value="">未対応</option>
          {ontologyAttributes.map((item) => (
            <option key={item.stableKey} value={item.stableKey}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>反応経路</span>
        <select value={responseChannel} onChange={(event) => setResponseChannel(event.target.value)}>
          {channels.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>支持</span>
        <select value={polarity} onChange={(event) => setPolarity(event.target.value as typeof polarity)}>
          <option value="positive">好き・肯定的</option>
          <option value="negative">苦手・否定的</option>
          <option value="mixed">両価的</option>
        </select>
      </label>
      <label>
        <span>強さ {Math.round(strength * 100)}%</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={strength}
          onChange={(event) => setStrength(Number(event.target.value))}
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function PreferenceAssertionEditControl(props: {
  item: {
    id: string;
    raw_label: string;
    stable_key: string | null;
    polarity: string;
    response_channel: string;
    strength: number;
  };
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <PreferenceAssertionForm
      initial={props.item}
      domain={props.domain}
      ontologyAttributes={props.ontologyAttributes}
      disabled={props.disabled}
      submitLabel="修正を保存"
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" disabled={props.disabled} onClick={() => setOpen(true)}>
      編集
    </button>
  );
}

function AddPreferenceAssertionControl(props: {
  domain: AnalysisDomain;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <PreferenceAssertionForm
      domain={props.domain}
      ontologyAttributes={props.ontologyAttributes}
      disabled={props.disabled}
      submitLabel="好みの候補を追加"
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" className="manual-add-button" disabled={props.disabled} onClick={() => setOpen(true)}>
      ＋ 好みの候補を手動追加
    </button>
  );
}

const orientationOptions = [
  "evil",
  "immoral",
  "indifferent_to_good",
  "transgressive",
  "self_defined",
  "good",
  "mixed",
] as const;
const stanceOptions = ["affirm", "accept", "indifferent", "ambivalent", "reject", "unspecified"] as const;

function ValueStanceForm({
  initial,
  disabled,
  onCancel,
  onMutate,
}: {
  initial?: { id: string; target_ref: string; stance: string; orientation: string };
  disabled: boolean;
  onCancel(): void;
  onMutate: PreferenceMutationHandler;
}) {
  const [targetRef, setTargetRef] = useState(initial?.target_ref ?? "");
  const [stance, setStance] = useState<(typeof stanceOptions)[number]>(
    stanceOptions.includes(initial?.stance as (typeof stanceOptions)[number])
      ? (initial?.stance as (typeof stanceOptions)[number])
      : "accept",
  );
  const [orientation, setOrientation] = useState<(typeof orientationOptions)[number]>(
    orientationOptions.includes(initial?.orientation as (typeof orientationOptions)[number])
      ? (initial?.orientation as (typeof orientationOptions)[number])
      : "mixed",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = initial
      ? await onMutate({ action: "update_value_stance", targetId: initial.id, targetRef, stance, orientation })
      : await onMutate({ action: "add_value_stance", targetRef, stance, orientation });
    if (saved) onCancel();
  }
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <label>
        <span>対象の価値・行為・結末</span>
        <input required maxLength={500} value={targetRef} onChange={(event) => setTargetRef(event.target.value)} />
      </label>
      <label>
        <span>価値傾向</span>
        <select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}>
          {orientationOptions.map((item) => (
            <option key={item} value={item}>
              {valueOrientationLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>あなたの捉え方</span>
        <select value={stance} onChange={(event) => setStance(event.target.value as typeof stance)}>
          {stanceOptions.map((item) => (
            <option key={item} value={item}>
              {valueStanceLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          保存
        </button>
      </div>
    </form>
  );
}

function ValueStanceEditControl(props: {
  item: { id: string; target_ref: string; stance: string; orientation: string };
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ValueStanceForm
      initial={props.item}
      disabled={props.disabled}
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" disabled={props.disabled} onClick={() => setOpen(true)}>
      編集
    </button>
  );
}

function AddValueStanceControl(props: { disabled: boolean; onMutate: PreferenceMutationHandler }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ValueStanceForm disabled={props.disabled} onCancel={() => setOpen(false)} onMutate={props.onMutate} />
  ) : (
    <button type="button" className="manual-add-button" disabled={props.disabled} onClick={() => setOpen(true)}>
      ＋ 価値スタンスを手動追加
    </button>
  );
}

function AssertionReviewControls({
  item,
  ontologyAttributes,
  disabled,
  onMutate,
}: {
  item: CharacterAssertionDetail;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [rawLabel, setRawLabel] = useState(item.raw_label);
  const [valueText, setValueText] = useState(item.value_text);
  const [attributeStableKey, setAttributeStableKey] = useState(item.stable_key ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onMutate({
      action: "update_assertion",
      targetId: item.id,
      rawLabel,
      valueText,
      attributeStableKey: attributeStableKey || null,
    });
    if (saved) setEditing(false);
  }
  if (editing)
    return (
      <form className="review-edit-form" onSubmit={submit}>
        <label>
          <span>Ontology属性（このラボ内だけ）</span>
          <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
            <option value="">未対応のまま保存</option>
            {ontologyAttributes.map((attribute) => (
              <option key={attribute.stableKey} value={attribute.stableKey}>
                {attribute.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>属性名</span>
          <input value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} maxLength={200} required />
        </label>
        <label>
          <span>内容</span>
          <textarea
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
        </label>
        <div className="review-edit-actions">
          <button type="button" className="button button-ghost" onClick={() => setEditing(false)} disabled={disabled}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={disabled}>
            修正を保存
          </button>
        </div>
      </form>
    );
  return (
    <div className="review-item-actions">
      <button type="button" onClick={() => setEditing(true)} disabled={disabled}>
        修正
      </button>
      <button
        type="button"
        className="danger-link"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`「${item.raw_label}」を解析結果から削除しますか？`))
            void onMutate({ action: "delete_assertion", targetId: item.id });
        }}
      >
        削除
      </button>
    </div>
  );
}

function AddAssertionControl({
  ontologyAttributes,
  disabled,
  onMutate,
}: {
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  const [rawLabel, setRawLabel] = useState("");
  const [valueText, setValueText] = useState("");
  const [attributeStableKey, setAttributeStableKey] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onMutate({
      action: "add_assertion",
      rawLabel,
      valueText,
      attributeStableKey: attributeStableKey || null,
    });
    if (!saved) return;
    setRawLabel("");
    setValueText("");
    setAttributeStableKey("");
    setOpen(false);
  }
  if (!open)
    return (
      <button type="button" className="manual-add-button" onClick={() => setOpen(true)} disabled={disabled}>
        ＋ 属性を手動追加
      </button>
    );
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <strong>属性を手動追加</strong>
      <label>
        <span>Ontology属性（このラボ内だけ）</span>
        <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
          <option value="">未対応のまま保存</option>
          {ontologyAttributes.map((attribute) => (
            <option key={attribute.stableKey} value={attribute.stableKey}>
              {attribute.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>属性名</span>
        <input value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} maxLength={200} required />
      </label>
      <label>
        <span>内容</span>
        <textarea
          value={valueText}
          onChange={(event) => setValueText(event.target.value)}
          maxLength={2000}
          rows={3}
          required
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={() => setOpen(false)} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          追加する
        </button>
      </div>
    </form>
  );
}

const deltaOperationOptions = [
  { value: "add", label: "新しい設定を追加" },
  { value: "modify", label: "原典の設定を変更" },
  { value: "remove", label: "原典の設定を適用しない" },
  { value: "invert", label: "原典と反対の設定にする" },
  { value: "narrow_scope", label: "適用範囲を限定" },
  { value: "emphasize", label: "原典の設定を強調" },
  { value: "inherit", label: "原典の設定を引き継ぐ" },
  { value: "unspecified", label: "その他の変更" },
] as const;
type DeltaOperation = (typeof deltaOperationOptions)[number]["value"];

function DeltaReviewForm({
  initial,
  targetId,
  disabled,
  onMutate,
  onCancel,
}: {
  initial?: CustomizationDeltaDetail;
  targetId?: string;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
  onCancel(): void;
}) {
  const [operation, setOperation] = useState<DeltaOperation>((initial?.operation as DeltaOperation) ?? "add");
  const [beforeValue, setBeforeValue] = useState(initial?.before_value ?? "");
  const [afterValue, setAfterValue] = useState(initial?.after_value ?? "");
  const [reasonText, setReasonText] = useState(initial?.reason_text ?? "");
  const options = targetId
    ? deltaOperationOptions
    : deltaOperationOptions.filter((item) => item.value !== "remove" && item.value !== "inherit");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = {
      operation,
      beforeValue: operation === "add" ? null : beforeValue.trim() || null,
      afterValue: operation === "remove" ? null : afterValue.trim() || null,
      reasonText: reasonText.trim() || null,
    };
    const saved = await onMutate(
      targetId ? { action: "update_delta", targetId, ...fields } : { action: "add_delta", ...fields },
    );
    if (saved) onCancel();
  }
  const requiresBefore = ["modify", "remove", "invert"].includes(operation);
  const requiresAfter = operation !== "remove";
  return (
    <form className="review-edit-form delta-edit-form" onSubmit={submit}>
      <strong>{targetId ? "差分を修正" : "差分を手動追加"}</strong>
      <label>
        <span>変更の種類</span>
        <select
          value={operation}
          onChange={(event) => {
            const next = event.target.value as DeltaOperation;
            setOperation(next);
            if (next === "add") setBeforeValue("");
            if (next === "remove") setAfterValue("");
          }}
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {operation !== "add" && (
        <label>
          <span>原典の設定</span>
          <textarea
            value={beforeValue}
            onChange={(event) => setBeforeValue(event.target.value)}
            maxLength={2000}
            rows={2}
            required={requiresBefore}
          />
        </label>
      )}
      {operation !== "remove" && (
        <label>
          <span>変更後の設定</span>
          <textarea
            value={afterValue}
            onChange={(event) => setAfterValue(event.target.value)}
            maxLength={2000}
            rows={2}
            required={requiresAfter}
          />
        </label>
      )}
      <label>
        <span>補足・判定理由（任意）</span>
        <textarea
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
          maxLength={2000}
          rows={2}
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          {targetId ? "修正を保存" : "追加する"}
        </button>
      </div>
    </form>
  );
}

function AddDeltaControl({ disabled, onMutate }: { disabled: boolean; onMutate: ReviewMutationHandler }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="manual-add-button" onClick={() => setOpen(true)} disabled={disabled}>
        ＋ 差分を手動追加
      </button>
    );
  return <DeltaReviewForm disabled={disabled} onMutate={onMutate} onCancel={() => setOpen(false)} />;
}

function CustomizationDeltaCard({
  item,
  targetName,
  editable = false,
  disabled = false,
  onMutate,
}: {
  item: CustomizationDeltaDetail;
  targetName: string;
  editable?: boolean;
  disabled?: boolean;
  onMutate?: ReviewMutationHandler;
}) {
  const [editing, setEditing] = useState(false);
  const operation = deltaOperationLabels[item.operation] ?? {
    label: "設定の変更",
    description: "登録内容から読み取った原典との差分です。",
  };
  return (
    <article className={`customization-delta delta-${item.operation}`}>
      <header className="customization-delta-header">
        <div>
          <div className="assertion-title">
            <strong>{operation.label}</strong>
            {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
          </div>
          <p>{operation.description}</p>
        </div>
        <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
      </header>
      <div className="customization-comparison">
        <section>
          <span>原典の設定</span>
          <p>{item.before_value ?? "該当する設定なし"}</p>
        </section>
        <span className="customization-arrow" aria-hidden="true">
          →
        </span>
        <section className="customization-target">
          <span>{targetName}の設定</span>
          <p>{item.after_value ?? "このキャラクター像では適用しない"}</p>
        </section>
      </div>
      {item.reason_text && (
        <p className="customization-reason">
          <strong>判定理由</strong>
          <span>{item.reason_text}</span>
        </p>
      )}
      {editable &&
        onMutate &&
        (editing ? (
          <DeltaReviewForm
            initial={item}
            targetId={item.id}
            disabled={disabled}
            onMutate={onMutate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="review-item-actions">
            <button type="button" onClick={() => setEditing(true)} disabled={disabled}>
              修正
            </button>
            <button
              type="button"
              className="danger-link"
              disabled={disabled}
              onClick={() => {
                if (window.confirm("この差分を解析結果から削除しますか？"))
                  void onMutate({ action: "delete_delta", targetId: item.id });
              }}
            >
              削除
            </button>
          </div>
        ))}
    </article>
  );
}

const evidenceInferenceLabels: Record<string, string> = {
  direct: "直接引用",
  paraphrase: "要約・言い換え",
  inferred: "推論",
};

const inputPointerLabels: Record<string, string> = {
  "/workTitle": "作品名",
  "/characterName": "キャラクター名",
  "/mediaType": "媒体種別",
  "/representationType": "改変種別",
  "/customizationDescription": "改変内容",
  "/characterBasicInfo": "キャラクター基本情報",
  "/preferenceContext": "対象範囲・場面",
  "/referenceMaterial": "追加の参考情報",
  "/userCharacterView": "ユーザーのキャラクター観",
  "/preference/likedReasons": "好きな理由",
  "/preference/dislikedReasons": "苦手な理由",
  "/preference/responseChannels": "選択した惹かれ方",
  "/preference/valueStanceNote": "価値スタンス",
};

function EvidenceList({ evidence }: { evidence: EvidenceDetail[] }) {
  if (!evidence.length) return <small className="evidence-status">根拠なし</small>;
  return (
    <details className="evidence-disclosure">
      <summary>
        <span className="evidence-open-label">詳細を見る</span>
        <span className="evidence-close-label">詳細を閉じる</span>
      </summary>
      <ul className="evidence-list">
        {evidence.map((item) => {
          const pointer = canonicalEntryInputPointer(item.inputPointer);
          return (
            <li key={item.id} className={`evidence-item evidence-${item.verificationStatus}`}>
              <div className="evidence-heading">
                <span className="evidence-status">
                  {evidenceStatusLabels[item.verificationStatus] ?? "検証状態未分類"}
                </span>
                <small>{evidenceInferenceLabels[item.inferenceType] ?? "根拠形式未分類"}</small>
              </div>
              {item.quote && (
                <div className="evidence-detail">
                  <span>引用</span>
                  <q>{evidenceQuoteLabel(item.quote, pointer)}</q>
                </div>
              )}
              {pointer && (
                <div className="evidence-detail">
                  <span>入力項目</span>
                  <strong>{inputPointerLabels[pointer] ?? "登録情報"}</strong>
                </div>
              )}
              {item.verificationStatus === "invalid" && (
                <small className="evidence-warning">
                  指定された入力または出典と照合できなかったため、この根拠は採用されません。
                </small>
              )}
              {(item.sourceProvider || item.trustReason) && (
                <small>
                  取得元:{" "}
                  {item.sourceProvider ? (evidenceSourceProviderLabels[item.sourceProvider] ?? "公開情報") : "公開情報"}
                  {item.trustReason ? `／採用理由: ${item.trustReason}` : ""}
                </small>
              )}
              {item.canNavigate && item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  原文へ移動
                </a>
              ) : item.sourceTitle ? (
                <small>出典: {item.sourceTitle}</small>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
