import type { AnalysisDomain } from "../../shared/analysis-domain";
import { Card, EmptyState, Notice, PageHeading, Spinner } from "../components/Ui";
import { EntryFormModal } from "../features/entries/EntryFormModal";
import { analysisErrorLabels, reanalyzableStatuses, statusLabels } from "../features/entries/presentation";
import { ReanalysisModal } from "../features/entries/ReanalysisModal";
import { ReviewModal } from "../features/entries/ReviewModal";
import { useEntries } from "../features/entries/use-entries";

export function EntriesPage({ domain }: { domain: AnalysisDomain }) {
  const {
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
  } = useEntries({ domain });
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
                    {entry.job.errorDetail ?? "エラーの詳細は記録されていません。"}
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
