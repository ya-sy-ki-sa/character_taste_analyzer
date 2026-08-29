import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import type { GeneratedCharacter, TasteProfile } from "../../shared/schemas";
import { traitById } from "../../shared/taxonomy";
import { api, idempotencyKey } from "../api";
import { Card, EmptyState, Modal, Notice, PageHeading, Rating, Spinner } from "../components/Ui";

type Generation = {
  id: string;
  profileSnapshotId: string;
  mode: "faithful" | "balanced" | "surprising";
  requestNote: string | null;
  result: GeneratedCharacter | null;
  similarityScore: number | null;
  similarityWarning: string | null;
  status: "queued" | "succeeded" | "failed";
  createdAt: string;
};

type Job = { id: string; status: string; progress: number; errorCode?: string };

const modes = [
  {
    id: "faithful" as const,
    symbol: "◎",
    title: "忠実",
    ratio: "既知の好み 100%",
    description: "確度の高い属性を中心に、安定した案を作ります。",
  },
  {
    id: "balanced" as const,
    symbol: "◐",
    title: "バランス",
    ratio: "既知 80% / 探索 20%",
    description: "好みの核を守りながら、新しい要素を少し試します。",
  },
  {
    id: "surprising" as const,
    symbol: "✦",
    title: "意外性",
    ratio: "既知 50% / 探索 50%",
    description: "好みから離れすぎない範囲で、予想外の案を探します。",
  },
];

export function GeneratePage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Generation["mode"]>("balanced");
  const [requestNote, setRequestNote] = useState("");
  const [jobId, setJobId] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: TasteProfile | null }>("/api/v1/profile"),
  });
  const generations = useQuery({
    queryKey: ["generations"],
    queryFn: () => api<{ generations: Generation[] }>("/api/v1/generations"),
  });
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<{ job: Job }>(`/api/v1/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && ["succeeded", "failed"].includes(query.state.data.job.status) ? false : 1_500,
  });

  useEffect(() => {
    if (!job.data || !["succeeded", "failed"].includes(job.data.job.status)) return;
    queryClient.invalidateQueries({ queryKey: ["generations"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  }, [job.data, queryClient]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api<{ generationId: string; job: Job }>("/api/v1/generations", {
        method: "POST",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify({ mode, requestNote: requestNote || undefined }),
      });
      setJobId(result.job.id);
      setDetailId(result.generationId);
      await queryClient.invalidateQueries({ queryKey: ["generations"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成を開始できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  const ready = Boolean(profile.data?.profile?.entryCount);
  return (
    <>
      <PageHeading
        eyebrow="CHARACTER GENERATOR"
        title="キャラ生成"
        description="分析済みの傾向から、特定作品を模倣しないオリジナルキャラクターを作ります。"
      />
      {!ready && !profile.isPending && (
        <Notice tone="warning">キャラクターを1件分析すると、生成できるようになります。</Notice>
      )}
      {profile.data?.profile?.provisional && ready && (
        <Notice tone="warning">
          登録が3件未満のため、暫定的な好みから生成します。探索要素として楽しんでください。
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {job.data && <GenerationJob job={job.data.job} />}

      <form onSubmit={generate}>
        <section className="generation-config">
          <div className="section-title">
            <div>
              <p className="eyebrow">GENERATION MODE</p>
              <h2>どのくらい冒険しますか？</h2>
            </div>
          </div>
          <div className="mode-grid">
            {modes.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`mode-card ${mode === item.id ? "active" : ""}`}
                onClick={() => setMode(item.id)}
              >
                <span className="mode-symbol">{item.symbol}</span>
                <span>
                  <strong>{item.title}</strong>
                  <b>{item.ratio}</b>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
          <Card className="generation-note">
            <label>
              <span>今回の追加リクエスト（任意）</span>
              <textarea
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                maxLength={1_000}
                rows={3}
                placeholder="例：現代のミステリー作品に登場できる設定。戦闘能力は不要。"
              />
              <small>{requestNote.length} / 1,000文字</small>
            </label>
            <button
              type="submit"
              className="button button-primary button-generate"
              disabled={
                !ready || submitting || Boolean(job.data && !["succeeded", "failed"].includes(job.data.job.status))
              }
            >
              {submitting ? "準備中…" : "✦ キャラクターを生成"}
            </button>
          </Card>
        </section>
      </form>

      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">GENERATED ARCHIVE</p>
            <h2>生成したキャラクター</h2>
          </div>
          <small>使用したプロフィール版へ固定</small>
        </div>
        {generations.isPending && <Spinner />}
        {generations.data?.generations.length === 0 && (
          <Card>
            <EmptyState icon="✦" title="まだ生成履歴はありません">
              モードを選び、最初のキャラクターを生成してみましょう。
            </EmptyState>
          </Card>
        )}
        <div className="generation-grid">
          {generations.data?.generations.map((generation) => (
            <button
              type="button"
              className="generation-card"
              key={generation.id}
              onClick={() => setDetailId(generation.id)}
            >
              <span className={`generation-mode mode-${generation.mode}`}>
                {modes.find((item) => item.id === generation.mode)?.title}
              </span>
              {generation.status === "succeeded" && generation.result ? (
                <>
                  <h3>{generation.result.name}</h3>
                  <p>{generation.result.concept}</p>
                  <footer>
                    <span>{new Date(generation.createdAt).toLocaleDateString("ja-JP")}</span>
                    <b>設定を見る →</b>
                  </footer>
                </>
              ) : (
                <>
                  <h3>{generation.status === "failed" ? "生成に失敗しました" : "生成中…"}</h3>
                  <p>
                    {generation.status === "failed"
                      ? "入力は消費されていません。時間を置いて再度お試しください。"
                      : "プロフィールから設計案を組み立てています。"}
                  </p>
                </>
              )}
            </button>
          ))}
        </div>
      </section>
      {detailId && (
        <GenerationDetail
          generationId={detailId}
          onClose={() => setDetailId(undefined)}
          onFeedback={() => {
            queryClient.invalidateQueries({ queryKey: ["profile"] });
            queryClient.invalidateQueries({ queryKey: ["generation", detailId] });
          }}
        />
      )}
    </>
  );
}

function GenerationJob({ job }: { job: Job }) {
  if (job.status === "succeeded")
    return <Notice tone="success">キャラクターを生成しました。フィードバックは任意です。</Notice>;
  if (job.status === "failed")
    return <Notice tone="danger">生成に失敗しました。プロフィールと入力データは変更されていません。</Notice>;
  return (
    <Notice tone="info">
      <span className="inline-progress">
        <i style={{ width: `${job.progress}%` }} />
      </span>
      キャラクターを設計しています… {job.progress}%
    </Notice>
  );
}

function GenerationDetail({
  generationId,
  onClose,
  onFeedback,
}: {
  generationId: string;
  onClose(): void;
  onFeedback(): void;
}) {
  const detail = useQuery({
    queryKey: ["generation", generationId],
    queryFn: () =>
      api<{ generation: Generation; feedback: Record<string, unknown> | null }>(`/api/v1/generations/${generationId}`),
    refetchInterval: (query) => (query.state.data?.generation.status === "queued" ? 1_500 : false),
  });
  const [rating, setRating] = useState<number>();
  const [liked, setLiked] = useState<string[]>([]);
  const [disliked, setDisliked] = useState<string[]>([]);
  const [adjustments, setAdjustments] = useState<Array<{ traitId: string; direction: "stronger" | "weaker" }>>([]);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();
  const [submitting, setSubmitting] = useState(false);

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(undefined);
    try {
      await api(`/api/v1/generations/${generationId}/feedback`, {
        method: "PUT",
        idempotencyKey: idempotencyKey(),
        body: JSON.stringify({
          overallRating: rating,
          likedTraitIds: liked.length ? liked : undefined,
          dislikedTraitIds: disliked.length ? disliked : undefined,
          intensityAdjustments: adjustments.length ? adjustments : undefined,
          comment: comment || undefined,
        }),
      });
      setNotice({
        tone: "success",
        message: "フィードバックを保存しました。分析プロフィールを再計算しています。",
      });
      onFeedback();
    } catch (caught) {
      setNotice({ tone: "danger", message: caught instanceof Error ? caught.message : "保存できませんでした" });
    } finally {
      setSubmitting(false);
    }
  }

  const generation = detail.data?.generation;
  const character = generation?.result;
  return (
    <Modal title={character?.name ?? "生成キャラクター"} onClose={onClose} wide>
      {detail.isPending && <Spinner label="生成結果を読み込んでいます" />}
      {generation?.status === "queued" && <Spinner label="キャラクターを生成しています" />}
      {generation?.status === "failed" && <Notice tone="danger">生成に失敗しました。</Notice>}
      {character && (
        <article className="character-sheet">
          <header>
            <span className={`generation-mode mode-${generation.mode}`}>
              {modes.find((item) => item.id === generation.mode)?.title}
            </span>
            <p>{character.concept}</p>
            {generation.similarityWarning && <Notice tone="warning">{generation.similarityWarning}</Notice>}
          </header>
          <div className="sheet-grid">
            <SheetSection number="01" title="外見" text={character.appearance} />
            <SheetSection number="02" title="性格" text={character.personality} />
            <SheetSection number="03" title="価値観と動機" text={character.valuesAndMotivation} />
            <SheetSection number="04" title="能力と弱点" text={character.abilitiesAndWeaknesses} />
            <SheetSection number="05" title="背景" text={character.background} />
            <SheetSection number="06" title="中心的な葛藤" text={character.centralConflict} />
            <SheetSection number="07" title="関係性" text={character.relationships} />
            <SheetSection number="08" title="話し方・仕草" text={character.voiceAndMannerisms} />
          </div>
          <section className="story-hooks">
            <p className="eyebrow">STORY HOOKS</p>
            <h3>物語の入口</h3>
            <ol>
              {character.storyHooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ol>
          </section>
          <section className="rationale">
            <p className="eyebrow">WHY THIS DESIGN</p>
            <h3>嗜好との対応</h3>
            <div>
              {character.tasteRationale.map((item) => (
                <span key={item.traitId}>
                  <strong>{traitById.get(item.traitId)?.label ?? item.traitId}</strong>
                  <small>{item.reason}</small>
                </span>
              ))}
            </div>
          </section>
          <form className="feedback-form" onSubmit={submitFeedback}>
            <div className="feedback-heading">
              <div>
                <p className="eyebrow">OPTIONAL FEEDBACK</p>
                <h3>このキャラ、どうでしたか？</h3>
              </div>
              <Rating value={rating} onChange={setRating} />
            </div>
            <p className="muted">すべて任意です。属性を選ぶと、その項目だけが明示嗜好として反映されます。</p>
            <div className="feedback-traits">
              {character.tasteRationale.map((item) => {
                const state = liked.includes(item.traitId)
                  ? "liked"
                  : disliked.includes(item.traitId)
                    ? "disliked"
                    : adjustments.find((adjustment) => adjustment.traitId === item.traitId)?.direction;
                return (
                  <div key={item.traitId}>
                    <strong>{traitById.get(item.traitId)?.label ?? item.traitId}</strong>
                    <select
                      value={state ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setLiked((items) =>
                          value === "liked"
                            ? [...items.filter((id) => id !== item.traitId), item.traitId]
                            : items.filter((id) => id !== item.traitId),
                        );
                        setDisliked((items) =>
                          value === "disliked"
                            ? [...items.filter((id) => id !== item.traitId), item.traitId]
                            : items.filter((id) => id !== item.traitId),
                        );
                        setAdjustments((items) =>
                          ["stronger", "weaker"].includes(value)
                            ? [
                                ...items.filter((adjustment) => adjustment.traitId !== item.traitId),
                                { traitId: item.traitId, direction: value as "stronger" | "weaker" },
                              ]
                            : items.filter((adjustment) => adjustment.traitId !== item.traitId),
                        );
                      }}
                    >
                      <option value="">未評価</option>
                      <option value="liked">良かった</option>
                      <option value="disliked">違った</option>
                      <option value="stronger">もっと強く</option>
                      <option value="weaker">もう少し弱く</option>
                    </select>
                  </div>
                );
              })}
            </div>
            <label>
              <span>自由な感想</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={2_000}
                rows={4}
                placeholder="好きだった部分、違和感、次に試してほしい方向など"
              />
            </label>
            {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
            <button
              type="submit"
              className="button button-primary"
              disabled={submitting || (!rating && !liked.length && !disliked.length && !adjustments.length && !comment)}
            >
              {submitting ? "保存中…" : "フィードバックを保存"}
            </button>
          </form>
        </article>
      )}
    </Modal>
  );
}

function SheetSection({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <section>
      <span>{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </section>
  );
}
