# 構成と正本

React SPAとAPIを同じWorkerで配信します。D1が保存データの正本、R2が非公開エクスポートの保存先、Workflowsが非同期処理の入口です。単一のnpmプロジェクトを維持します。

## 資産の所有

| 役割 | 正本 | 生成・参照先 |
| --- | --- | --- |
| テーブル・制約 | [database/migrations](../database/migrations) | Wrangler、結合テスト、評価 |
| 通常版・dark版の属性 | [shared/catalogs](../shared/catalogs) | migrationsのseed SQL、[語彙一覧](generated/ontology.md) |
| HTTP API | [worker/routes](../worker/routes) のOpenAPIHono登録 | [OpenAPI](../contracts/generated/openapi.json) |
| 外部入力・出力 | [shared/contracts](../shared/contracts) のZod定義 | TypeScript型、公開JSON Schema |
| プロンプト | [worker/llm/prompts](../worker/llm/prompts) とregistry | バージョン・ハッシュ一覧 |
| 評価ケース | [evaluation/cases.ts](../evaluation/cases.ts)、[fixtures](../evaluation/fixtures) | 単体・結合テスト、評価CLI |
| 過去資料 | [archive](../archive/README.md) | 履歴参照のみ |

`assets:generate` はソースから生成し、`assets:check` はメモリー上の生成結果とディスクを比較します。チェックに書き込み機能はありません。プロンプト本文はregistryから取得し、ソースの正規表現解析に依存しません。本文変更時はバージョン更新も検査します。

## サーバーの依存方向

`worker/index.ts`、`worker/workflows.ts`、HTTPルートが実行入口です。入口から `worker/features` のユースケースを直接呼びます。

- `entries`: 登録、一覧、再分析、レビュー、除外、追加質問。
- `analysis`: 入力準備、理解、好み分析、スコープ判定、結果判定、Fake出力、保存処理。
- `profile`: 決定論的集計、グラフ、現在のスナップショット。
- `generation`: 条件、候補生成、検証、履歴、採用、評価、削除。
- `account`: 会員設定、エクスポート、削除。
- `jobs`: claim、lease、再試行の判定と状態更新。

SQLは各機能の `repositories` に置き、D1PreparedStatementを返します。ユースケースが複数リポジトリのstatementを同じ `DB.batch` にまとめるため、分割しても原子的更新の境界を分断しません。HTTPの認証・セッション用SQLも対応する `repositories` に置きます。

`worker/platform/outbox/write.ts` はイベント作成、`dispatch.ts` は配送管理です。配送は渡された実行関数を呼び、機能サービスを参照しません。`worker/runtime` がローカル実行・Workflowの接続を担当します。機能やplatformからruntimeへの逆参照は許可しません。`architecture:check` がこれらの境界、循環依存、実装から履歴・テストへの依存を検査します。

LLMのプロンプト、provider実行、出力スキーマ、純粋な結果判定、Fake出力、D1操作を分離します。固定指示は `worker/llm/prompts` に集約し、通常版・dark版と処理目的から必要な本文を組み立てます。各ユースケースは処理順序、入力データ、モデル割当、再試行の条件を保持します。外部出典の参照方法は `worker/platform/provenance/registry.ts` が正本です。

`preferenceSystem(domain, stage)`、`hypothesisSystem(domain)`、`understandingSystem(stage)`、`generationValidationSystem(domain)` は、実行時とプロンプトregistryで同じ組み立て関数を使います。版固有の指示は該当版だけに渡し、仮説提案に抽出・監査用の出力指示を混ぜません。補完、追加回答、JSON修復、生成案の比較などの固定指示もregistryのハッシュ・バージョン検査へ含めます。ユーザー入力を含む実メッセージのハッシュはモデル実行記録へ別途保存します。

プロンプトはシステム間の処理仕様として記述します。入力契約、用語の定義、判断手順、優先順位、不変条件、出力への対応、判断不能時の扱いを処理に必要な範囲で分けます。専門用語は作業定義を添え、記号論・意味論等の概念を具体的な判定規則へ対応づけます。境界事例は保持し、構造・型の正本は出力Schemaに置きます。[プロンプト記述方針](prompt-specification.md)に適用範囲と変更時の確認事項をまとめています。

モデル実行記録のstatement生成は `worker/llm/model-runs.ts` と対応するリポジトリに集約します。分析・生成それぞれのユースケースがプロンプト／スキーマのバージョンを決め、分析では結果と同じbatch、生成では個別の即時保存という境界を保持します。providerの接続・要求構築は `openai.ts` / `workers-ai.ts`、応答解釈は `response.ts`、構造検証と修復は `remote.ts`、経路選択は `providers.ts` が担当します。

登録と再分析の人物表現・入力資料の構築は `entries/input-preparation.ts` に集約し、ID生成は呼び出し元が担当します。分析結果の属性・根拠のstatement構築は `analysis/*-statements.ts`、失敗時の記録と状態更新は `analysis/attempt-failure.ts` に分けます。人物理解レビューは `entries/understanding-mutations.ts` が操作別のstatementを準備し、ユースケースが一括保存します。

プロフィールの寄与計算・集約は `profile/aggregation.ts`、DB取得・保存・世代切替は `profile/projection.ts` が担当します。属性と価値態度は、登録内の最大値を選び、同一人物・同一作品の寄与を割り引く共通手順を使用します。

## APIとブラウザー

通常版は `/api/v1`、dark版は `/api/v1/dark`。両方とも生成履歴一覧は `GET /generation-requests`、削除は `DELETE /generation-requests/{id}` です。旧URLへの別名はありません。

JSON成功応答は `{ data: ... }`、エラーは `{ error: { code, message, ... } }`。204応答とエクスポートダウンロードはJSON envelopeを使いません。レスポンスはHTTP境界で共有Zod定義に照らして検証します。OpenAPIは実際のルート登録から生成します。

入力スキーマの `z.input` と、デフォルト値・正規化を適用した `z.output` / `z.infer` を区別します。フロントエンドは共有定義から導出した型を `import type` で参照し、`src/features/*/api.ts` で機能別の通信関数を公開します。`src/lib/http.ts` がCSRF・セッション・envelopeを処理します。ブラウザー用の入力補助は `shared/entry-input.ts` に置き、サーバー用Zod定義を実行時に読み込みません。

登録・再分析の送信用は `EntrySubmission` / `DarkEntrySubmission`、検証後にユースケースへ渡す型は `EntryDraft` / `DarkEntryDraft` です。同一人物候補の `IdentityCandidate` はレスポンススキーマから導出します。

## 画面とCSS

`src/pages` は画面の組み立て、`src/features` はフォーム、レビュー、候補比較、採用・評価と対応するフックです。登録入力の変換、送信の冪等キー、ポーリング、キャッシュ更新をそれぞれの責務にまとめます。プロフィール・グラフは遅延読み込みを維持します。

CSSの入口は `src/styles/index.css`。基礎、共通部品、画面、レスポンシブ、テーマに分け、レイヤーの優先順位を入口で明示します。`themes` のobservatoryレイヤーは既存の共通美術表現を担当し、通常版・dark版の役割トークン、色、配置を保持します。上書き済みの不要な宣言を除去し、テーマ切替に必要な定義は残します。


### 人物理解の情報量と根拠集計

人物像の全体信頼度は計算・公開しません。通常版の `informationQuality` はS02監査が保存した解析時点の記録です。欠落は未評価とし、手動編集では更新しません。dark版へ通常版の監査を追加するものではありません。

レビューAPIとアカウントエクスポートの `evidenceSummary` は、現在表示する属性を対象に取得時に計算します。却下・置換済み属性を除き、スナップショット内で根拠IDを重複計上しません。分類は検証状態を先に判定し、原文照合済みだけを出所で分けます。無効・未分類も内訳として記録し、根拠がない属性と区別します。件数は資料数・正確性・引用の意味的な支持範囲の評価ではありません。個別の登録内支持度、好みの候補保持、プロフィールの重みには使いません。

カスタムdark版の `darkBaseline` は別形式の比較資料であり、もともと全体信頼度や属性一覧を持ちません。情報量は未評価として表示し、共通の `baseUnderstanding` や属性件数へ変換しません。
