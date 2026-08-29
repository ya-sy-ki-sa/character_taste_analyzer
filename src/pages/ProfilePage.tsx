import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { GraphProjection, ProfileDimension, ProfileView } from "../../shared/schemas";
import { api } from "../api";
import { TasteGraph } from "../components/TasteGraph";
import { Card, EmptyState, Notice, PageHeading, Spinner } from "../components/Ui";

const classificationLabels = { stable: "安定傾向", emerging: "発展中", insufficient: "データ少" } as const;
const channelLabels: Record<string, string> = {
  person_liking: "人物として",
  aesthetic_liking: "感覚的な好み",
  admiration: "憧れ",
  empathy: "共感",
  narrative_interest: "物語上の関心",
  fascination_with_transgression: "逸脱への魅了",
  root_for: "勝ってほしい",
  love_to_hate: "嫌悪を含む楽しみ",
  desire_no_redemption: "改心しないでほしい",
};

export function ProfilePage() {
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: ProfileView | null }>("/api/v1/profile"),
    refetchInterval: 10_000,
  });
  const graph = useQuery({
    queryKey: ["profile-graph"],
    queryFn: () => api<{ graph: GraphProjection | null }>("/api/v1/profile/graph?detail=standard"),
    enabled: Boolean(profile.data?.profile),
  });
  if (profile.isPending) return <Spinner label="嗜好プロフィールを読み込んでいます" />;
  if (profile.isError) return <Notice tone="danger">嗜好プロフィールを読み込めませんでした。</Notice>;
  const value = profile.data.profile;
  if (!value)
    return (
      <>
        <PageHeading
          eyebrow="YOUR TASTE PROFILE"
          title="嗜好解析結果"
          description="確認済みの登録だけを、根拠と明示性を保ったまま累積集計します。"
        />
        <Card>
          <EmptyState
            icon="⌁"
            title="確認済みの解析がまだありません"
            action={
              <Link className="button button-primary" to="/app/entries">
                キャラクターを登録
              </Link>
            }
          >
            キャラクター理解と嗜好候補を確認すると、ここに最初のプロフィールが作られます。
          </EmptyState>
        </Card>
      </>
    );
  const likes = value.dimensions.filter((item) => item.positiveScore >= item.negativeScore);
  const dislikes = value.dimensions.filter((item) => item.negativeScore > item.positiveScore);
  return (
    <>
      <PageHeading
        eyebrow="YOUR TASTE PROFILE"
        title="嗜好解析結果"
        description="善悪・ヒーロー／ヴィラン・主役／端役による優劣をつけず、どこにどう惹かれるかを表示します。"
        action={
          <Link className="button button-primary" to="/app/generate">
            ✦ この嗜好から作成
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
              <b>{value.dimensions.length}</b>嗜好次元
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
          <p>最大傾向の確信度です。好みの確率や人格評価ではありません。</p>
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
                <strong>{orientationLabel(item.orientation)}</strong>
                <span>
                  {stanceLabel(item.stance)}・{item.count}件
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
            <h2>嗜好のつながり</h2>
          </div>
          <small>ブラウザ内で探索・描画</small>
        </div>
        <Card>
          {graph.isPending && <Spinner label="グラフを構築しています" />}
          {graph.isError && (
            <Notice tone="danger">グラフを読み込めませんでした。上の一覧は引き続き利用できます。</Notice>
          )}
          {graph.data?.graph && <TasteGraph projection={graph.data.graph} />}
        </Card>
      </section>
    </>
  );
}

function DimensionRow({ item, rank, negative = false }: { item: ProfileDimension; rank: number; negative?: boolean }) {
  const score = negative ? item.negativeScore : item.positiveScore;
  return (
    <div className="trait-row">
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <div className="trait-copy">
        <strong>{item.label}</strong>
        <small>
          {item.category}・
          {item.responseChannel ? (channelLabels[item.responseChannel] ?? item.responseChannel) : "反応経路なし"}・根拠{" "}
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

function orientationLabel(value: string) {
  return (
    (
      {
        evil: "悪そのもの",
        immoral: "非道徳",
        indifferent_to_good: "善への無関心",
        transgressive: "規範逸脱",
        self_defined: "自己定義の規範",
        good: "善",
        mixed: "複合",
      } as Record<string, string>
    )[value] ?? value
  );
}

function stanceLabel(value: string) {
  return (
    (
      {
        affirm: "肯定",
        accept: "受容",
        indifferent: "判断対象にしない",
        ambivalent: "両価的",
        reject: "支持しない",
        unspecified: "未指定",
      } as Record<string, string>
    )[value] ?? value
  );
}
