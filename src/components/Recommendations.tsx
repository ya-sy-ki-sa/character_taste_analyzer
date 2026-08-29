import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CharacterRecommendationResult } from "../../shared/schemas";
import { traitById } from "../../shared/taxonomy";
import { api, idempotencyKey } from "../api";
import { Card, Notice, Spinner } from "./Ui";

type RecommendationRun = {
  id: string;
  profileSnapshotId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result: CharacterRecommendationResult | null;
  errorCode: string | null;
  createdAt: string;
};

const likelihoodLabels = {
  high: "一致度 高",
  medium: "一致度 中",
  exploratory: "探索候補",
} as const;

export function Recommendations({ profileSnapshotId }: { profileSnapshotId?: string }) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const recommendations = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => api<{ recommendations: RecommendationRun[] }>("/api/v1/recommendations"),
    refetchInterval: (query) => {
      const status = query.state.data?.recommendations[0]?.status;
      return status && ["queued", "running"].includes(status) ? 1_500 : false;
    },
  });
  const latest = recommendations.data?.recommendations[0];
  const isRunning = Boolean(latest && ["queued", "running"].includes(latest.status));

  async function requestRecommendations() {
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await api<{ recommendation: RecommendationRun }>("/api/v1/recommendations", {
        method: "POST",
        idempotencyKey: idempotencyKey(),
      });
      queryClient.setQueryData<{ recommendations: RecommendationRun[] }>(["recommendations"], (current) => ({
        recommendations: [
          response.recommendation,
          ...(current?.recommendations.filter((item) => item.id !== response.recommendation.id) ?? []),
        ],
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候補表示を開始できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section-block recommendation-section">
      <div className="section-title recommendation-heading">
        <div>
          <p className="eyebrow">CHARACTER DISCOVERY</p>
          <h2>好きかもしれない既存キャラクター</h2>
          <p>現在までの分析傾向を使い、実行するたびにAIが候補を選びます。</p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={requestRecommendations}
          disabled={submitting || isRunning}
        >
          {submitting ? "準備中…" : isRunning ? "候補を選定中…" : latest ? "もう一度選び直す" : "✦ 候補を表示"}
        </button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {recommendations.isError && !error && <Notice tone="danger">候補の履歴を読み込めませんでした。</Notice>}
      {isRunning && (
        <Card className="recommendation-loading">
          <Spinner label="分析傾向に合う既存キャラクターを選んでいます" />
        </Card>
      )}
      {latest?.status === "failed" && !isRunning && (
        <Notice tone="danger">候補を選べませんでした。時間を置いて、もう一度お試しください。</Notice>
      )}
      {!latest && !recommendations.isPending && !recommendations.isError && (
        <Card className="recommendation-intro">
          <span aria-hidden="true">✦</span>
          <p>「候補を表示」を押すと、異なる作品から4〜6人を選び、一致する傾向と注意点を表示します。</p>
        </Card>
      )}
      {latest?.status === "succeeded" && latest.result && (
        <RecommendationResult
          recommendation={latest}
          result={latest.result}
          isCurrentProfile={!profileSnapshotId || latest.profileSnapshotId === profileSnapshotId}
        />
      )}
      <p className="recommendation-disclaimer">
        候補はAIの一般知識に基づく推測で、好みとの一致を保証するものではありません。作品名・人物名や説明が不正確な場合があります。
      </p>
    </section>
  );
}

function RecommendationResult({
  recommendation,
  result,
  isCurrentProfile,
}: {
  recommendation: RecommendationRun;
  result: CharacterRecommendationResult;
  isCurrentProfile: boolean;
}) {
  return (
    <div className="recommendation-result" aria-live="polite">
      <Card className="recommendation-note">
        <div>
          <p className="eyebrow">SELECTION NOTE</p>
          <p>{result.selectionNote}</p>
        </div>
        <small>
          {new Date(recommendation.createdAt).toLocaleString("ja-JP")}
          {!isCurrentProfile && "・分析更新前の結果"}
        </small>
      </Card>
      <div className="recommendation-grid">
        {result.candidates.map((candidate) => (
          <article className="recommendation-card" key={`${candidate.workTitle}:${candidate.characterName}`}>
            <header>
              <div>
                <small>{candidate.workTitle}</small>
                <h3>{candidate.characterName}</h3>
              </div>
              <span className={`recommendation-likelihood likelihood-${candidate.likelihood}`}>
                {likelihoodLabels[candidate.likelihood]}
              </span>
            </header>
            <p className="recommendation-medium">{candidate.mediaType}</p>
            <p>{candidate.reason}</p>
            <ul className="recommendation-traits" aria-label="一致した傾向">
              {candidate.matchedTraitIds.map((traitId) => (
                <li key={traitId}>{traitById.get(traitId)?.label ?? traitId}</li>
              ))}
            </ul>
            {candidate.possibleMismatch && (
              <p className="recommendation-mismatch">
                <strong>合わない可能性：</strong>
                {candidate.possibleMismatch}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
