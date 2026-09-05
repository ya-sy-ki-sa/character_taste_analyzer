import type { AnalysisDomain } from "../../shared/analysis-domain";
import { generationErrorLabel } from "../../shared/presentation-labels";
import { Card, EmptyState, Notice, PageHeading, Spinner } from "../components/Ui";
import { CandidateComparison } from "../features/generation/CandidateComparison";
import { CharacterModal } from "../features/generation/CharacterModal";
import { GenerationConditions, modes } from "../features/generation/GenerationConditions";
import { GenerationFeedback } from "../features/generation/GenerationFeedback";
import { useGeneration } from "../features/generation/use-generation";

export function GeneratePage({ domain }: { domain: AnalysisDomain }) {
  const {
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
  } = useGeneration({ domain });
  return (
    <>
      <PageHeading
        eyebrow="ORIGINAL CHARACTER STUDIO"
        title="オリジナルキャラクター作成"
        description="固定した好みのスナップショットから、使う項目と避ける項目を自分で選んで作成します。"
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {snapshot.isPending && <Spinner label="生成に使う好みを準備しています" />}
      {!snapshot.isPending && !snapshot.data?.snapshot && (
        <Card>
          <EmptyState icon="✦" title="先に好み分析を確定してください">
            確認済みの好みプロフィールが1世代以上必要です。
          </EmptyState>
        </Card>
      )}
      {snapshot.data?.snapshot && (
        <GenerationConditions
          mode={mode}
          setMode={setMode}
          purpose={purpose}
          setPurpose={setPurpose}
          world={world}
          setWorld={setWorld}
          genre={genre}
          setGenre={setGenre}
          role={role}
          setRole={setRole}
          tone={tone}
          setTone={setTone}
          instruction={instruction}
          setInstruction={setInstruction}
          treatments={treatments}
          setTreatments={setTreatments}
          overrides={overrides}
          setOverrides={setOverrides}
          submitting={submitting}
          snapshot={snapshot}
          groupedSnapshotItems={groupedSnapshotItems}
          submit={submit}
          selectedCount={selectedCount}
        />
      )}
      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">GENERATED ARCHIVE</p>
            <h2>作成履歴</h2>
          </div>
          <small>生成だけでは好みプロフィールを変更しません</small>
        </div>
        {generations.isPending && <Spinner />}
        {generations.data?.generations.length === 0 && (
          <Card>
            <EmptyState icon="✦" title="まだ作成履歴がありません">
              好みの項目とモードを選び、最初のキャラクターを作成できます。
            </EmptyState>
          </Card>
        )}
        <div className="generation-grid">
          {generations.data?.generations.map((item) => {
            const terminal = ["generated", "failed", "cancelled"].includes(item.status);
            const title = item.character?.identity.name ?? (item.status === "failed" ? "失敗した生成" : "生成中の項目");
            return (
              <article className="generation-history-item" key={item.generationRequestId}>
                <button
                  type="button"
                  className="generation-card"
                  onClick={() => item.character && setDetail(item)}
                  disabled={!item.character}
                >
                  <span className={`generation-mode mode-${item.mode}`}>
                    {modes.find((mode) => mode.id === item.mode)?.title}
                  </span>
                  {item.character ? (
                    <>
                      <h3>{item.character.identity.name}</h3>
                      <p>{item.character.identity.oneLineConcept}</p>
                      {Boolean(item.candidates.length) && (
                        <small>
                          {item.candidates.some((candidate) => candidate.selected)
                            ? "採用済み"
                            : `${item.candidates.length}案 · 採用する案を選択`}
                        </small>
                      )}
                      <footer>
                        <span>{new Date(item.createdAt).toLocaleDateString("ja-JP")}</span>
                        <b>設定を見る →</b>
                      </footer>
                    </>
                  ) : (
                    <>
                      <h3>{item.status === "failed" ? "生成に失敗" : "生成中…"}</h3>
                      <p>{generationErrorLabel(item.job.errorCode)}</p>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="generation-delete-button"
                  disabled={!terminal || deletingId === item.generationRequestId}
                  title={terminal ? undefined : "生成処理が完了すると削除できます"}
                  onClick={() => void removeHistory(item)}
                  aria-label={`「${title}」の履歴を削除`}
                >
                  {deletingId === item.generationRequestId ? "削除中…" : "削除"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <GenerationFeedback domain={domain} />
      {detail?.character && (
        <CharacterModal
          character={detail.character}
          onClose={() => setDetail(undefined)}
          comparison={
            detail.candidates.length ? (
              <>
                {error && <Notice tone="danger">{error}</Notice>}
                <CandidateComparison
                  options={detail.candidates}
                  activeId={
                    detail.candidates.find((item) => item.character.identity.name === detail.character?.identity.name)
                      ?.id
                  }
                  pending={selecting}
                  onView={(option) => setDetail({ ...detail, character: option.character })}
                  onSelect={(option) => void selectCandidate(option)}
                />
              </>
            ) : null
          }
        >
          {Boolean(detail.candidates.length) && (
            <GenerationFeedback
              key={detail.character.identity.name}
              domain={domain}
              option={detail.candidates.find(
                (item) => item.character.identity.name === detail.character?.identity.name,
              )}
            />
          )}
        </CharacterModal>
      )}
    </>
  );
}
