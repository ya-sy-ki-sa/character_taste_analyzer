import { Link } from "react-router-dom";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { Brand } from "../components/Ui";

const capabilities = [
  {
    number: "01",
    title: "キャラクター像と好みを分ける",
    description: "キャラクターが持つ特徴と、その特徴に自分がどう反応したかを、別の段階・別のデータとして扱います。",
  },
  {
    number: "02",
    title: "「好き」の意味を分ける",
    description: "人物としての好感、共感、憧れ、同一化、興味、親近感、見た目や演技など、44種類の反応経路を区別します。",
  },
  {
    number: "03",
    title: "善悪と好意を混同しない",
    description: "悪役としての魅力、逸脱への興味、人物への好意、現実での道徳的支持を、同じものとして扱いません。",
  },
  {
    number: "04",
    title: "根拠の由来を残す",
    description: "利用者の入力、公開情報、モデル知識を分け、可能なものは入力欄や引用元まで追跡できる形で保存します。",
  },
  {
    number: "05",
    title: "人が確認してから反映する",
    description:
      "AIが作ったキャラクター理解と嗜好候補には、それぞれ確認段階があります。確認済みの登録だけをプロフィールに反映します。",
  },
  {
    number: "06",
    title: "重複を抑えて積み上げる",
    description:
      "同じキャラクターや同じ作品の反復を独立した好みとして数えすぎないようにし、複数作品で繰り返す傾向を重視します。",
  },
] as const;

const analysisSteps = [
  ["登録", "既成、カスタムした既成、オリジナルの3方式から登録します。"],
  ["理解を抽出", "入力と利用可能な公開情報から、キャラクターの特徴候補を整理します。"],
  ["理解を確認", "利用者が候補を追加・修正・削除し、対象の基本像を確定します。"],
  ["嗜好を抽出", "確認済みの理解と好き・苦手の理由から、反応経路ごとの候補を作ります。"],
  ["嗜好を確認", "不要な候補を除き、残した内容をプロフィールへ反映します。"],
  ["累積表示", "固定ルールで重複を補正し、一覧、グラフ、キャラクター生成に利用します。"],
] as const;

export function AnalyzerStatusPage({ domain }: { domain: AnalysisDomain }) {
  const dark = domain === "dark";
  return (
    <main className={`analyzer-status-page ${dark ? "dark-lab-theme" : ""}`}>
      <nav className="status-nav" aria-label="ページナビゲーション">
        <Link className="brand-link" to={dark ? "/dark-lab" : "/"} aria-label="キャラ嗜好ラボのトップへ">
          <Brand />
        </Link>
        <Link className="button button-secondary" to={dark ? "/dark-lab" : "/"}>
          ← トップへ戻る
        </Link>
      </nav>

      <header className="status-hero">
        <div>
          <p className="eyebrow">{dark ? "DARK ANALYZER STATUS" : "CURRENT ANALYZER STATUS"}</p>
          <h1>
            {dark ? "ダーク専用分析器が、" : "この分析器が、"}
            <br />
            <em>いま何をしているのか。</em>
          </h1>
          <p className="status-lead">
            {dark
              ? "通常Ontologyを使わず、悪・堕落・洗脳・操作・裏切り・ダークな道徳と関係性を専用属性で扱います。適格性、主体性、状態、差分、嗜好を多段で解析し、各段階を監査します。"
              : "キャラ嗜好ラボは、好きなキャラクターの名前から性格を診断するものではありません。登録したキャラクターのどこに、どのような意味で惹かれるのかを、根拠と確認を残しながら整理するための分析器です。"}
          </p>
        </div>
        <aside className="status-verdict" aria-label="現在の評価">
          <p className="eyebrow">CURRENT VERDICT</p>
          <strong>
            探索的な
            <br />
            個人内嗜好整理ツール
          </strong>
          <p>自分の好みを振り返る用途には有用な基礎設計です。</p>
          <span>心理尺度・性格診断としては未検証</span>
        </aside>
      </header>

      <section className="status-metrics" aria-label="分析器の構成">
        <div>
          <strong>94</strong>
          <span>統制属性</span>
          <small>外見、性格、価値、役割など14カテゴリ</small>
        </div>
        <div>
          <strong>44</strong>
          <span>反応経路</span>
          <small>好感、同一化、興味、価値支持など</small>
        </div>
        <div>
          <strong>3</strong>
          <span>登録方式</span>
          <small>既成、既成カスタム、オリジナル</small>
        </div>
        <div>
          <strong>v1.1.0</strong>
          <span>集計ルール</span>
          <small>LLMではなく固定式でプロフィール化</small>
        </div>
      </section>

      <section className="status-section">
        <div className="status-section-heading">
          <p className="eyebrow">WHAT IT DOES</p>
          <h2>現在できること</h2>
          <p>一つの「好き」にまとめず、対象、反応、価値判断、根拠を分けて扱います。</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article key={item.number}>
              <span>{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="status-section status-flow-section">
        <div className="status-section-heading">
          <p className="eyebrow">ANALYSIS FLOW</p>
          <h2>分析がプロフィールになるまで</h2>
          <p>AIによる候補作成と、利用者による確認を交互に行います。</p>
        </div>
        <ol className="status-flow">
          {analysisSteps.map(([title, description], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="status-section">
        <div className="status-section-heading">
          <p className="eyebrow">HOW TO READ</p>
          <h2>表示される数値の読み方</h2>
        </div>
        <div className="reading-grid">
          <article>
            <span aria-hidden="true">↗</span>
            <h3>スコア</h3>
            <p>登録内の根拠が、正または負の反応をどれだけ支持しているかを、独自の固定式で累積した値です。</p>
          </article>
          <article>
            <span aria-hidden="true">◎</span>
            <h3>登録内支持度</h3>
            <p>根拠の強さと、キャラクター・作品・根拠件数の広がりを合わせた独自指標です。正しい確率ではありません。</p>
          </article>
          <article>
            <span aria-hidden="true">≋</span>
            <h3>安定傾向</h3>
            <p>
              複数のキャラクターと作品で反復したことを示す分類です。心理学的に安定した人格特性という意味ではありません。
            </p>
          </article>
        </div>
        <div className="status-note">
          <strong>大切な前提</strong>
          <p>
            0〜1や百分率で表示される値は、確率、偏差値、一般人口との比較値ではありません。現在の登録から見える傾向を整理するための内部指標です。
          </p>
        </div>
      </section>

      <section className="status-section status-evaluation">
        <div className="status-section-heading">
          <p className="eyebrow">ACADEMIC REVIEW</p>
          <h2>学術的な観点から見た現在地</h2>
          <p>設計上の慎重さと、測定器としての検証状況を分けて評価しています。</p>
        </div>
        <div className="evaluation-columns">
          <article className="evaluation-positive">
            <span>評価できる点</span>
            <h3>概念を混同しにくい設計</h3>
            <ul>
              <li>好感、類似、同一化、共感、興味、価値支持を分ける</li>
              <li>キャラクターの特徴と利用者の反応を分ける</li>
              <li>悪役への魅力を現実の道徳的支持に置き換えない</li>
              <li>根拠の由来を保存し、人による確認段階を置く</li>
              <li>現実の人格、病理、危険性を推測しない</li>
            </ul>
          </article>
          <article className="evaluation-limited">
            <span>まだ検証されていない点</span>
            <h3>科学的な測定器としての妥当性</h3>
            <ul>
              <li>94属性・44反応経路の内容妥当性と因子構造</li>
              <li>実際のLLM抽出と人間の判断との一致率</li>
              <li>同じ入力を再分析したときの再現性</li>
              <li>スコアと「登録内支持度」の統計的な校正</li>
              <li>文化、言語、時点が変わった場合の同等性</li>
            </ul>
          </article>
        </div>
        <p className="evaluation-conclusion">
          <strong>総合評価:</strong>
          自己理解を支援する探索的ツールとしては有望ですが、妥当化された心理尺度・科学的診断器ではありません。
        </p>
      </section>

      <section className="status-section status-boundary">
        <div className="status-section-heading">
          <p className="eyebrow">BOUNDARIES</p>
          <h2>この分析結果からは言えないこと</h2>
        </div>
        <ul>
          <li>利用者の本当の性格や、無意識の本心</li>
          <li>精神状態、病理、危険性などの臨床的な判断</li>
          <li>ある特徴を好きである科学的な確率</li>
          <li>一般人口と比べて好みが強いかどうか</li>
          <li>ある特徴が好みを引き起こしたという因果関係</li>
          <li>未視聴作品を含む、将来好きになるキャラクターの保証</li>
        </ul>
      </section>

      <section className="status-quality">
        <div>
          <p className="eyebrow">SOFTWARE STATUS</p>
          <h2>実装の確認状況</h2>
          <p>
            現在の仕様は、実装コード、画面、データベース定義、実行時schemaを照合して整理しています。ソフトウェアテストは通過していますが、これは心理測定上の妥当性を証明するものではありません。
          </p>
        </div>
        <div className="quality-count">
          <strong>102</strong>
          <span>tests passed</span>
          <small>15 test files・2026年8月30日確認</small>
        </div>
      </section>

      <footer className="status-footer">
        <Brand />
        <p>好きの輪郭を、根拠と限界を分けて見つめます。</p>
        <Link className="button button-primary" to="/">
          トップページへ
        </Link>
      </footer>
    </main>
  );
}
