import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ProfileTrait, TasteProfile } from "../../shared/schemas";
import { api } from "../api";
import { Recommendations } from "../components/Recommendations";
import { Card, EmptyState, Notice, PageHeading, Spinner } from "../components/Ui";

const confidenceLabels = {
  hypothesis: "仮説",
  candidate: "候補",
  moderate: "中程度",
  strong: "強い傾向",
} as const;

export function ProfilePage() {
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () =>
      api<{ profileSnapshotId?: string; profile: TasteProfile | null; entryCount?: number }>("/api/v1/profile"),
    refetchInterval: 10_000,
  });

  if (profile.isPending) return <Spinner label="分析プロフィールを読み込んでいます" />;
  if (profile.isError) return <Notice tone="danger">分析プロフィールを読み込めませんでした。</Notice>;
  if (!profile.data.profile) {
    return (
      <>
        <PageHeading
          eyebrow="YOUR TASTE PROFILE"
          title="分析プロフィール"
          description="登録したキャラクターから、共通点と明示的な好みを分けて分析します。"
        />
        <Card>
          <EmptyState
            icon="◇"
            title="最初のキャラクターを登録しましょう"
            action={
              <Link className="button button-primary" to="/app/entries">
                キャラクターを登録
              </Link>
            }
          >
            概要を一つ登録すると、最初の暫定分析が始まります。
          </EmptyState>
        </Card>
      </>
    );
  }

  const data = profile.data.profile;
  return (
    <>
      <PageHeading
        eyebrow="YOUR TASTE PROFILE"
        title="分析プロフィール"
        description="頻出する特徴と、あなたが明示した好みは別々に扱っています。"
        action={
          <Link className="button button-primary" to="/app/generate">
            ✦ この傾向から生成
          </Link>
        }
      />
      {data.provisional && (
        <Notice tone="warning">
          <strong>暫定分析です。</strong> 3件以上登録すると、偶然の共通点を見分けやすくなります。
        </Notice>
      )}

      <section className="profile-overview">
        <Card className="summary-card">
          <p className="eyebrow">ANALYSIS SUMMARY</p>
          <blockquote>“{data.summary}”</blockquote>
          <div className="summary-meta">
            <span>
              <b>{data.entryCount}</b>登録キャラ
            </span>
            <span>
              <b>{data.frequentTraits.length}</b>表示中の属性
            </span>
            <span>
              <b>v{data.version}</b>プロフィール版
            </span>
          </div>
        </Card>
        <Card className="confidence-card">
          <p className="eyebrow">EVIDENCE HEALTH</p>
          <div
            className="evidence-ring"
            style={{ "--value": Math.min(100, data.entryCount * 12) } as React.CSSProperties}
          >
            <strong>
              {Math.min(100, data.entryCount * 12)}
              <small>%</small>
            </strong>
          </div>
          <p>入力が増えるほど、傾向の確かさを区別しやすくなります。</p>
        </Card>
      </section>

      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">FREQUENT PATTERNS</p>
            <h2>好きなキャラによく現れる属性</h2>
          </div>
          <small>頻出 ≠ 明示的な好み</small>
        </div>
        {data.frequentTraits.length ? (
          <Card className="trait-list">
            {data.frequentTraits.map((trait, index) => (
              <TraitRow
                key={trait.traitId}
                trait={trait}
                maximum={data.frequentTraits[0]?.occurrenceWeight || 1}
                rank={index + 1}
              />
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyState icon="⌁" title="共通属性を分析中">
              登録内容から根拠を確認できた属性がここに表示されます。
            </EmptyState>
          </Card>
        )}
      </section>

      <section className="two-column section-block">
        <Card>
          <div className="card-title">
            <div>
              <p className="eyebrow">EXPLICIT LIKES</p>
              <h2>明示された好き</h2>
            </div>
            <span className="status-dot positive" />
          </div>
          <TraitChips traits={data.explicitLikes} empty="好きな点や属性フィードバックを入力すると表示されます。" />
        </Card>
        <Card>
          <div className="card-title">
            <div>
              <p className="eyebrow">EXPLICIT AVOIDS</p>
              <h2>明示された苦手</h2>
            </div>
            <span className="status-dot negative" />
          </div>
          <TraitChips
            traits={data.explicitDislikes}
            empty="苦手な点や生成フィードバックを入力すると表示されます。"
            negative
          />
        </Card>
      </section>

      <Recommendations profileSnapshotId={profile.data.profileSnapshotId} />

      {data.contradictions.length > 0 && (
        <section className="section-block">
          <Card>
            <div className="card-title">
              <div>
                <p className="eyebrow">CONTEXT MATTERS</p>
                <h2>状況によって評価が分かれる属性</h2>
              </div>
            </div>
            <TraitChips traits={data.contradictions} empty="" />
          </Card>
        </section>
      )}

      {data.clusters.length > 0 && (
        <section className="section-block">
          <div className="section-title">
            <div>
              <p className="eyebrow">TASTE CLUSTERS</p>
              <h2>好みのまとまり</h2>
            </div>
            <small>8件以上で表示</small>
          </div>
          <div className="cluster-grid">
            {data.clusters.map((cluster) => (
              <Card key={cluster.id}>
                <span className="cluster-number">{cluster.id.replace("cluster-", "0")}</span>
                <h3>{cluster.label}</h3>
                <p>{cluster.entryIds.length}件のキャラクター</p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TraitRow({ trait, maximum, rank }: { trait: ProfileTrait; maximum: number; rank: number }) {
  const width = Math.max(8, (trait.occurrenceWeight / maximum) * 100);
  return (
    <div className="trait-row">
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <div className="trait-copy">
        <strong>{trait.label}</strong>
        <small>
          {trait.category}・根拠 {trait.evidenceCount}件
        </small>
      </div>
      <div className="trait-meter">
        <i style={{ width: `${width}%` }} />
      </div>
      <span className={`confidence confidence-${trait.confidence}`}>{confidenceLabels[trait.confidence]}</span>
    </div>
  );
}

function TraitChips({
  traits,
  empty,
  negative = false,
}: {
  traits: ProfileTrait[];
  empty: string;
  negative?: boolean;
}) {
  if (!traits.length) return <p className="muted">{empty}</p>;
  return (
    <div className="trait-chips">
      {traits.map((trait) => (
        <span className={negative ? "negative" : ""} key={trait.traitId}>
          {trait.label}
          <small>{trait.evidenceIds.length}</small>
        </span>
      ))}
    </div>
  );
}
