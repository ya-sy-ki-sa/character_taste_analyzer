import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import {
  briefCoverageStatusLabel,
  briefTreatmentLabel,
  generationErrorLabel,
  snapshotItemLabel,
  snapshotItemTypeLabel,
} from "../../shared/presentation-labels";
import { responseChannelLabel } from "../../shared/response-channels";
import type { AnyGeneratedCharacterCandidate, GenerationRequestInput } from "../../shared/schemas";
import { api, idempotencyKey } from "../api";
import { CandidateComparison, GenerationFeedback, type GenerationOption } from "../components/QualityControls";
import { Card, EmptyState, Modal, Notice, PageHeading, Spinner } from "../components/Ui";
import {
  expandSnapshotTreatments,
  type GenerationSnapshotItem,
  groupGenerationSnapshotItems,
  type SnapshotTreatment,
  snapshotConditionLabel,
} from "../lib/generation-snapshot-items";

type SnapshotResponse = { snapshot: { id: string; generation: number } | null; items: GenerationSnapshotItem[] };
type GenerationRow = {
  id: string | null;
  generationRequestId: string;
  status: string;
  mode: GenerationRequestInput["mode"];
  createdAt: string;
  character: AnyGeneratedCharacterCandidate | null;
  candidates: GenerationOption[];
  job: { status: string | null; errorCode: string | null };
};

const modes: Array<{ id: GenerationRequestInput["mode"]; symbol: string; title: string; description: string }> = [
  { id: "faithful", symbol: "◎", title: "忠実", description: "選択項目を必須条件として強く反映します。" },
  { id: "balanced", symbol: "◐", title: "バランス", description: "選択した核を保ち、少数の新しい要素を加えます。" },
  { id: "exploratory", symbol: "✦", title: "探索", description: "禁止条件を守りつつ、意外な組合せを探します。" },
];

export function GeneratePage({ domain }: { domain: AnalysisDomain }) {
  const dark = domain === "dark";
  const apiBase = dark ? "/api/v1/dark" : "/api/v1";
  const generationListPath = dark ? `${apiBase}/generations` : `${apiBase}/generated-characters`;
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
    queryFn: () => api<SnapshotResponse>(`${apiBase}/profile/snapshot-items`),
  });
  const generations = useQuery({
    queryKey: ["generated-characters", domain],
    queryFn: () => api<{ generations: GenerationRow[] }>(generationListPath),
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
      await api(`${apiBase}/generation-requests`, {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify({
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
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["generated-characters", domain] });
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
      await api(
        dark
          ? `${apiBase}/generations/${item.generationRequestId}`
          : `${apiBase}/generation-requests/${item.generationRequestId}`,
        { method: "DELETE" },
      );
      if (detail?.generationRequestId === item.generationRequestId) setDetail(undefined);
      await queryClient.invalidateQueries({ queryKey: ["generated-characters", domain] });
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
      await api(`${apiBase}/generation-requests/${detail.generationRequestId}/selection`, {
        method: "POST",
        body: JSON.stringify({ candidateId: option.id }),
      });
      setDetail({
        ...detail,
        character: option.character,
        candidates: detail.candidates.map((item) => ({ ...item, selected: item.id === option.id })),
      });
      await queryClient.invalidateQueries({ queryKey: ["generated-characters", domain] });
      setNotice("採用する案を保存しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "採用を保存できませんでした");
    } finally {
      setSelecting(false);
    }
  }
  const selectedCount = expandSnapshotTreatments(groupedSnapshotItems, treatments, overrides).selectedItemIds.length;
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
        <form onSubmit={submit} className="generation-config">
          <div className="section-title">
            <div>
              <p className="eyebrow">PROFILE SNAPSHOT</p>
              <h2>使う好みを選ぶ</h2>
            </div>
            <small>プロフィール世代 {snapshot.data.snapshot.generation} に固定</small>
          </div>
          <Card className="selection-table">
            <div className="selection-head">
              <span>好みの項目</span>
              <span>扱い</span>
            </div>
            {groupedSnapshotItems.map((item) => (
              <div className="selection-row" key={item.id}>
                <span>
                  <strong>{snapshotItemLabel(item)}</strong>
                  <small>
                    {snapshotItemTypeLabel(item.type)}
                    {item.responseChannels.length
                      ? `・${item.responseChannels.map((channel) => responseChannelLabel(channel)).join("／")}`
                      : ""}
                    {snapshotScopeLabel(item.conditions)}
                  </small>
                  {item.itemIds.length > 1 && (
                    <details className="condition-details">
                      <summary>条件・惹かれ方ごとに調整</summary>
                      {item.itemIds.map((id) => {
                        const individual = snapshot.data?.items.find((candidate) => candidate.id === id);
                        if (!individual) return null;
                        const condition = individual.payload.condition ?? individual.payload.scope;
                        const scope = snapshotConditionLabel(condition);
                        return (
                          <label className="quality-question" key={id}>
                            <span>
                              {responseChannelLabel(String(individual.payload.responseChannel ?? ""))}
                              {scope ? ` · ${scope}` : ""}
                            </span>
                            <select
                              aria-label={`${individual.label}の条件別の扱い`}
                              value={overrides[id] ?? treatments[item.id] ?? "omit"}
                              onChange={(event) =>
                                setOverrides({ ...overrides, [id]: event.target.value as SnapshotTreatment })
                              }
                            >
                              <option value="include">使う</option>
                              <option value="prohibit">入れない</option>
                              <option value="omit">今回は使わない</option>
                            </select>
                          </label>
                        );
                      })}
                    </details>
                  )}
                </span>
                <select
                  value={treatments[item.id] ?? "omit"}
                  onChange={(event) => {
                    setTreatments((current) => ({ ...current, [item.id]: event.target.value as SnapshotTreatment }));
                    setOverrides((current) =>
                      Object.fromEntries(Object.entries(current).filter(([id]) => !item.itemIds.includes(id))),
                    );
                  }}
                >
                  <option value="include">使う</option>
                  <option value="prohibit">入れない</option>
                  <option value="omit">今回は使わない</option>
                </select>
              </div>
            ))}
          </Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">GENERATION MODE</p>
              <h2>生成モード</h2>
            </div>
          </div>
          <div className="mode-grid">
            {modes.map((item) => (
              <button
                type="button"
                className={`mode-card ${mode === item.id ? "active" : ""}`}
                onClick={() => setMode(item.id)}
                key={item.id}
              >
                <span className="mode-symbol">{item.symbol}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
          <Card className="generation-form-card">
            <div className="form-grid">
              <label className="full">
                <span>
                  作成目的 <b>必須</b>
                </span>
                <textarea
                  required
                  maxLength={2000}
                  rows={2}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </label>
              <label className="full">
                <span>世界観</span>
                <textarea maxLength={4000} rows={3} value={world} onChange={(event) => setWorld(event.target.value)} />
              </label>
              <label>
                <span>ジャンル</span>
                <input maxLength={200} value={genre} onChange={(event) => setGenre(event.target.value)} />
              </label>
              <label>
                <span>物語上の役割</span>
                <input
                  maxLength={2000}
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="物語の中での役割を入力してください"
                />
              </label>
              <label>
                <span>表現トーン</span>
                <input maxLength={1000} value={tone} onChange={(event) => setTone(event.target.value)} />
              </label>
              <label className="full">
                <span>自由指示</span>
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="button button-primary button-generate"
              disabled={submitting || selectedCount === 0}
            >
              {submitting ? "生成条件を保存中…" : `✦ 選択した${selectedCount}項目から作成`}
            </button>
          </Card>
        </form>
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

function snapshotScopeLabel(conditions: Record<string, unknown>[]): string {
  const labels = [...new Set(conditions.map(snapshotConditionLabel).filter(Boolean))];
  return labels.length ? `・${labels.join(" ／ ")}` : "";
}

function CharacterModal({
  character,
  onClose,
  children,
  comparison,
}: {
  character: AnyGeneratedCharacterCandidate;
  onClose(): void;
  children?: ReactNode;
  comparison?: ReactNode;
}) {
  const sections = [
    ["外見", character.appearance],
    ["性格", character.personality],
    ["動機", character.motivations],
    ["能力と限界", character.abilitiesAndLimits],
  ] as const;
  return (
    <Modal title={character.identity.name} onClose={onClose} wide>
      <article className="character-sheet">
        <header>
          <p>{character.identity.oneLineConcept}</p>
          <small>{character.identity.origin}</small>
        </header>
        {comparison}
        <div className="sheet-grid">
          {sections.map(([title, section], index) => (
            <section className="sheet-section" key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{section.summary}</p>
                <ul>
                  {Array.from(new Map(section.traits.map((trait) => [JSON.stringify(trait), trait])).values()).map(
                    (trait) => (
                      <li key={JSON.stringify(trait)}>
                        <strong>{trait.label}</strong> — {trait.description}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </section>
          ))}
          <section className="sheet-section">
            <span>05</span>
            <div>
              <h3>価値観と道徳</h3>
              <p>{character.valuesAndMorality.moralRelationship}</p>
              <p>
                <strong>改心:</strong> {character.valuesAndMorality.redemption}
              </p>
              <p>
                <strong>隠れた善性:</strong> {character.valuesAndMorality.hiddenGoodness}
              </p>
            </div>
          </section>
          <section className="sheet-section">
            <span>06</span>
            <div>
              <h3>役割と変化</h3>
              <p>
                {character.narrativeRole.role} — {character.narrativeRole.function}
              </p>
              <p>
                {character.characterArc.start} → {character.characterArc.end}
              </p>
            </div>
          </section>
        </div>
        <section className="rationale">
          <p className="eyebrow">PREFERENCE BASIS</p>
          <h3>好みとの対応</h3>
          <div>
            {character.briefCoverage.map((item) => (
              <span key={item.profileSnapshotItemId}>
                <strong>
                  {briefTreatmentLabel(item.treatment)} ／ {briefCoverageStatusLabel(item.status)}
                </strong>
                <small>{item.explanation}</small>
              </span>
            ))}
          </div>
        </section>
        {character.schemaVersion === "dark-1.0" && (
          <section className="rationale dark-generation-detail">
            <p className="eyebrow">DARK STATE MODEL</p>
            <h3>ダーク状態・主体性・変化</h3>
            <p>{character.darkCore.narrativeFunction}</p>
            <p>
              <strong>主体性:</strong> {character.darkCore.agency.agencyOrigin} ／ <strong>同意:</strong>{" "}
              {character.darkCore.agency.consent} ／ <strong>責任:</strong> {character.darkCore.agency.responsibility}
            </p>
            <p>
              <strong>契機:</strong> {character.baselineAndTransition.trigger ?? "未確定"}
            </p>
            <p>{character.darkMorality.logic}</p>
            <p>{character.darkArc.possibleOutcome}</p>
          </section>
        )}
        {children}
      </article>
    </Modal>
  );
}
