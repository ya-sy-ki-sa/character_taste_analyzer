import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { attributeCategoryLabel } from "../../shared/presentation-labels";
import { responseChannelLabel } from "../../shared/response-channels";
import type { GraphProjection, ProfileView, ProjectionFreshness } from "../../shared/schemas";
import { valueOrientationLabel, valueStanceLabel } from "../../shared/value-stance-labels";
import { api } from "../api";
import { Card, EmptyState, Notice, PageHeading, Spinner } from "../components/Ui";
import { type DisplayProfileDimension, groupProfileDimensions } from "../lib/profile-dimensions";

const classificationLabels = { stable: "安定傾向", emerging: "発展中", insufficient: "データ少" } as const;
const TasteGraph = lazy(() => import("../components/TasteGraph").then((module) => ({ default: module.TasteGraph })));
export function ProfilePage({ domain }: { domain: AnalysisDomain }) {
  const dark = domain === "dark";
  const apiBase = dark ? "/api/v1/dark" : "/api/v1";
  const appBase = dark ? "/dark-lab/app" : "/app";
  const profile = useQuery({
    queryKey: ["profile", domain],
    queryFn: () => api<{ profile: ProfileView | null; freshness: ProjectionFreshness }>(`${apiBase}/profile`),
    refetchInterval: 10_000,
  });
  const graph = useQuery({
    queryKey: ["profile-graph", domain],
    queryFn: () => api<{ graph: GraphProjection | null }>(`${apiBase}/profile/graph?detail=standard`),
    enabled: Boolean(profile.data?.profile),
  });
  if (profile.isPending) return <Spinner label="好みプロフィールを読み込んでいます" />;
  if (profile.isError) return <Notice tone="danger">好みプロフィールを読み込めませんでした。</Notice>;
  const value = profile.data.profile;
  if (!value && profile.data.freshness.status === "rebuilding")
    return (
      <>
        <PageHeading
          eyebrow="YOUR TASTE PROFILE"
          title="好み分析結果"
          description="確認済みデータからプロフィールとグラフを再構築しています。"
        />
        <Card>
          <Spinner
            label={`プロフィールを再構築しています（${profile.data.freshness.builtGeneration} → ${profile.data.freshness.desiredGeneration}）`}
          />
        </Card>
      </>
    );
  if (!value)
    return (
      <>
        <PageHeading
          eyebrow="YOUR TASTE PROFILE"
          title="好み分析結果"
          description="確認済みの登録だけを、根拠と明示性を保ったまま累積集計します。"
        />
        <Card>
          <EmptyState
            icon="⌁"
            title="確認済みの解析がまだありません"
            action={
              <Link className="button button-primary" to={`${appBase}/entries`}>
                キャラクターを登録
              </Link>
            }
          >
            キャラクター理解と好みの候補を確認すると、ここに最初のプロフィールが作られます。
          </EmptyState>
        </Card>
      </>
    );
  const likes = groupProfileDimensions(value.dimensions.filter((item) => item.positiveScore >= item.negativeScore));
  const dislikes = groupProfileDimensions(value.dimensions.filter((item) => item.negativeScore > item.positiveScore));
  return (
    <>
      <PageHeading
        eyebrow="YOUR TASTE PROFILE"
        title="好み分析結果"
        description="これまでの解析結果から、キャラクターのどこにどう惹かれるかを表示します。"
        action={
          <Link className="button button-primary" to={`${appBase}/generate`}>
            ✦ この好みから作成
          </Link>
        }
      />
      {value.entryCount < 3 && (
        <Notice tone="warning">
          <strong>発展中のプロフィールです。</strong>{" "}
          一人への強い好みは明瞭に表示しますが、複数作品にまたがる安定傾向とは区別しています。
        </Notice>
      )}
      <section className="profile-overview">
        <Card className="summary-card">
          <p className="eyebrow">PROFILE GENERATION</p>
          <blockquote>
            “
            {likes
              .slice(0, 4)
              .map((item) => item.label)
              .join("、") || "あなたの言葉から輪郭を作成中"}
            ”
          </blockquote>
          <div className="summary-meta">
            <span>
              <b>{value.entryCount}</b>確認済み登録
            </span>
            <span>
              <b>{likes.length + dislikes.length}</b>表示属性
            </span>
            <span>
              <b>v{value.generation}</b>集計世代
            </span>
          </div>
        </Card>
        <Card className="confidence-card">
          <p className="eyebrow">EVIDENCE HEALTH</p>
          <div
            className="evidence-ring"
            style={{ "--value": Math.round((value.dimensions[0]?.confidence ?? 0) * 100) } as React.CSSProperties}
          >
            <strong>
              {Math.round((value.dimensions[0]?.confidence ?? 0) * 100)}
              <small>%</small>
            </strong>
          </div>
          <p>最大傾向の登録内支持度です。好みの確率や人格評価ではありません。</p>
        </Card>
      </section>
      {value.valueStances.length > 0 && (
        <section className="section-block">
          <div className="section-title">
            <div>
              <p className="eyebrow">VALUE STANCES</p>
              <h2>価値・善悪との関わり方</h2>
            </div>
            <small>人物への好意や道徳的支持とは別系列</small>
          </div>
          <div className="stance-grid">
            {value.valueStances.map((item) => (
              <Card key={`${item.orientation}:${item.stance}`}>
                <strong>{valueOrientationLabel(item.orientation)}</strong>
                <span>
                  {valueStanceLabel(item.stance)}・{item.count}件
                </span>
                <small>{item.labels.slice(0, 4).join("、")}</small>
              </Card>
            ))}
          </div>
        </section>
      )}
      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">POSITIVE DIMENSIONS</p>
            <h2>惹かれる属性</h2>
          </div>
          <small>正負は相殺せず別々に保存</small>
        </div>
        {likes.length ? (
          <Card className="trait-list">
            {likes.map((item, index) => (
              <DimensionRow item={item} rank={index + 1} key={item.id} />
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyState icon="◇" title="好きな属性を解析中">
              好きな理由を具体的に入力すると、明示根拠として表示します。
            </EmptyState>
          </Card>
        )}
      </section>
      {dislikes.length > 0 && (
        <section className="section-block">
          <div className="section-title">
            <div>
              <p className="eyebrow">NEGATIVE DIMENSIONS</p>
              <h2>苦手・避けたい属性</h2>
            </div>
          </div>
          <Card className="trait-list">
            {dislikes.map((item, index) => (
              <DimensionRow item={item} rank={index + 1} negative key={item.id} />
            ))}
          </Card>
        </section>
      )}
      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">BROWSER GRAPH ENGINE</p>
            <h2>好みのつながり</h2>
          </div>
          <small>ブラウザ内で探索・描画</small>
        </div>
        <Card>
          {graph.isPending && <Spinner label="グラフを構築しています" />}
          {graph.isError && (
            <Notice tone="danger">グラフを読み込めませんでした。上の一覧は引き続き利用できます。</Notice>
          )}
          {graph.data?.graph && (
            <Suspense fallback={<Spinner label="グラフ表示を読み込んでいます" />}>
              <TasteGraph projection={graph.data.graph} />
            </Suspense>
          )}
        </Card>
      </section>
    </>
  );
}

function DimensionRow({
  item,
  rank,
  negative = false,
}: {
  item: DisplayProfileDimension;
  rank: number;
  negative?: boolean;
}) {
  const score = negative ? item.negativeScore : item.positiveScore;
  const scopes = item.conditions.flatMap((condition) => (typeof condition.scope === "string" ? [condition.scope] : []));
  const includesWholeCharacter = item.conditions.some((condition) => Object.keys(condition).length === 0);
  const scopeLabel = [...(includesWholeCharacter ? ["キャラクター全体"] : []), ...scopes].join("／");
  return (
    <div className="trait-row">
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <div className="trait-copy">
        <strong>{item.label}</strong>
        <small>
          {attributeCategoryLabel(item.category)}・
          {item.responseChannels.length
            ? item.responseChannels.map((channel) => responseChannelLabel(channel)).join("／")
            : "反応経路なし"}
          {scopeLabel ? `・対象：${scopeLabel}` : ""}・支持 +{Math.round(item.positiveScore * 100)} / -
          {Math.round(item.negativeScore * 100)}・確認済み {item.identityCount}人／{item.workCount}作品・独立根拠
          {item.evidenceCount}件
        </small>
      </div>
      <div className={`trait-meter ${negative ? "negative" : ""}`}>
        <i style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      <span className={`confidence confidence-${item.classification}`}>
        {classificationLabels[item.classification]} {Math.round(item.confidence * 100)}%
      </span>
    </div>
  );
}
