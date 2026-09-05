# 構成と正本

React SPAとAPIを同じWorkerで配信します。D1が保存データの正本、R2が非公開エクスポートの保存先、Workflowsが非同期処理の入口です。単一のnpmプロジェクトを維持します。

## 資産の所有

| 役割 | 正本 | 生成・参照先 |
| --- | --- | --- |
| テーブル・制約 | [database/migrations/001_initial.sql](../database/migrations/001_initial.sql) | Wrangler、結合テスト、評価 |
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

LLMのプロンプト、provider実行、出力スキーマ、純粋な結果判定、Fake出力、D1操作を分離します。処理順序、プロンプト本文、モデル割当、再試行の条件は各ユースケースに保持します。

## APIとブラウザー

通常版は `/api/v1`、dark版は `/api/v1/dark`。両方とも生成履歴一覧は `GET /generation-requests`、削除は `DELETE /generation-requests/{id}` です。旧URLへの別名はありません。

JSON成功応答は `{ data: ... }`、エラーは `{ error: { code, message, ... } }`。204応答とエクスポートダウンロードはJSON envelopeを使いません。レスポンスはHTTP境界で共有Zod定義に照らして検証します。OpenAPIは実際のルート登録から生成します。

入力スキーマの `z.input` と、デフォルト値・正規化を適用した `z.output` / `z.infer` を区別します。フロントエンドは共有定義から導出した型を `import type` で参照し、`src/features/*/api.ts` で機能別の通信関数を公開します。`src/lib/http.ts` がCSRF・セッション・envelopeを処理します。ブラウザー用の入力補助は `shared/entry-input.ts` に置き、サーバー用Zod定義を実行時に読み込みません。

## 画面とCSS

`src/pages` は画面の組み立て、`src/features` はフォーム、レビュー、候補比較、採用・評価と対応するフックです。登録入力の変換、送信の冪等キー、ポーリング、キャッシュ更新をそれぞれの責務にまとめます。プロフィール・グラフは遅延読み込みを維持します。

CSSの入口は `src/styles/index.css`。基礎、共通部品、画面、レスポンシブ、テーマに分け、レイヤーの優先順位を入口で明示します。`themes` のobservatoryレイヤーは既存の共通美術表現を担当し、通常版・dark版の役割トークン、色、配置を保持します。上書き済みの不要な宣言を除去し、テーマ切替に必要な定義は残します。
