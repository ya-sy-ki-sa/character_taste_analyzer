# キャラ嗜好ラボ

好きな既存・オリジナルキャラクターの記述から、根拠を追跡できる嗜好プロフィールを育て、そのプロフィールから新しい文章キャラクターを生成する日本語Webアプリです。React SPAとHono APIを1つのCloudflare Workerとして配信します。

## 実装済みの主な機能

- 公開ユーザー一覧、Unicode正規化した重複不可ユーザー名、作成後15分のpending有効化
- 作成時に一度だけ表示するUUIDアクセスキー、30日セッション、キー変更、JSONエクスポート、全削除
- 既存キャラとオリジナルキャラの登録・revision編集・物理削除・重複検出
- `202 Accepted + jobId` とポーリングによる分析・生成・フィードバック再計算
- 完全一致引用の検証、版管理した58属性、自由タグ隔離、決定論的集計、訂正イベント優先
- 頻出属性・明示的な好き／苦手・矛盾・根拠数・信頼度を分けたプロフィール
- 現在のプロフィールから既存作品の候補を毎回LLMで4〜6人選ぶキャラクター推薦（異作品・根拠属性・注意点付き）
- 8件以上でBGE-M3埋め込みと正規化属性を使う決定論的k-medoidsクラスタリング
- 忠実／バランス／意外性モード、固定プロフィールsnapshot、類似度再生成と警告
- 5段階・属性別・強弱・自由文の任意フィードバック（未評価の生成物は根拠にしない）
- 本番はOpenAI Responses APIを主系、開発はWorkers AIを主系とする交換可能なprovider
- D1、Vectorize、Workflows、Turnstile、CSRF/Origin、CSP、HMAC資格情報、日次クォータ、IP/ユーザーrate limit

## ローカル起動

Node.js 22以上とnpmを使います。

```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars の AUTH_PEPPER を十分に長いランダム値へ変更
npm run db:migrate:local
npm run dev
```

`http://localhost:5173` を開いてください。開発環境では `ALLOW_LOCAL_AI_FALLBACK=true` と `USE_REMOTE_AI_IN_DEV=true` が既定で、Workers AIを優先して使用します。分析・生成でWorkers AIを利用できない場合は、根拠付きの決定論的なローカル代替へフォールバックできます。既存キャラクター推薦は実在候補をローカルで捏造しないため、リモートLLMが利用できない場合は失敗として表示します。リモートAIを使わずに他の導線を確認したい場合は `USE_REMOTE_AI_IN_DEV=false` を設定してください。

ローカル開発のrate limitはE2Eを連続実行できる高い値にしてあります。stagingとproductionでは環境別設定の厳しい上限が適用されます。

`.dev.vars` はgit対象外です。最低限次を設定します。

```dotenv
AUTH_PEPPER=32バイト以上のランダム秘密値
OPENAI_API_KEY=
TURNSTILE_SECRET=
```

Turnstileを画面へ表示する場合、ビルド環境に `VITE_TURNSTILE_SITE_KEY` も設定します。

## AI provider

ドメイン層にはSDK固有型を持ち込まず、`StructuredLlmProvider` と `EmbeddingProvider` の境界を通します。既定値は次の通りです。

- OpenAI: `gpt-5.6-sol`、Responses API、strict JSON Schema、`store:false`
- Workers AI: `@cf/openai/gpt-oss-120b`、JSON Schema応答を同じZod schemaで再検証
- Embedding: `@cf/baai/bge-m3`、1024次元

構造検証に失敗した場合は同一providerで1回だけ修復し、その後Workers AIへ切り替えます。AI Gatewayを `OPENAI_BASE_URL` に指定した場合も、リクエストごとに本文ログを無効化し、キャッシュを必ず迂回します。アプリ側へ生レスポンスや思考過程は保存しません。

モデルは `wrangler.jsonc` の `OPENAI_MODEL`、`WORKERS_AI_MODEL`、`EMBEDDING_MODEL` で差し替えられます。新モデルを本番へ入れる前に固定評価セットで影運用してください。

## Cloudflareリソースとデプロイ

本番はWorkers Paidを前提とします。D1は作成時にAPACを指定し、stagingとproductionを別リソースにしてください。

```bash
npx wrangler d1 create character-taste-lab-staging --location=apac
npx wrangler d1 create character-taste-lab --location=apac
npx wrangler vectorize create character-taste-bge-m3-staging --dimensions=1024 --metric=cosine
npx wrangler vectorize create character-taste-bge-m3 --dimensions=1024 --metric=cosine
```

表示されたD1 IDを `wrangler.jsonc` の各 `database_id` へ設定します。次に環境ごとのSecretsを登録します。

```bash
npx wrangler secret put AUTH_PEPPER --env staging --config wrangler.jsonc
npx wrangler secret put OPENAI_API_KEY --env staging --config wrangler.jsonc
npx wrangler secret put TURNSTILE_SECRET --env staging --config wrangler.jsonc

npx wrangler secret put AUTH_PEPPER --env production --config wrangler.jsonc
npx wrangler secret put OPENAI_API_KEY --env production --config wrangler.jsonc
npx wrangler secret put TURNSTILE_SECRET --env production --config wrangler.jsonc
```

AI Gatewayを使う場合は、provider-native OpenAI URLを `OPENAI_BASE_URL` として環境varsへ追加します。Gateway側ではpayload保存を無効にし、アプリの `cf-aig-collect-log-payload:false` と合わせて二重に保護してください。

```bash
npm run db:migrate:staging
npm run deploy:staging

npm run db:migrate:production
npm run deploy:production
```

WorkflowsとAI bindingsは `wrangler.jsonc` に環境別で定義済みです。staging/productionの独自ドメインを使う場合は、各環境の `APP_ORIGIN` をその厳密なoriginへ設定してください。

## データと分析の原則

D1が正本で、Vectorizeは再構築可能な派生インデックスです。登録時の作品名・キャラ名は識別と重複検出だけに使い、分析LLMや推薦LLMへは渡しません。分析は入力された概要・好きな点・苦手な点だけを使い、引用が原文へ完全一致しない属性を破棄します。

属性の出現回数は好みと断定しません。明示嗜好は好きな点、苦手な点、訂正、生成フィードバックだけで更新します。同一キャラ・旧revisionを二重計上せず、同一作品の偏りを `1/sqrt(n)` で弱めます。ユーザー訂正は不変イベントとして残り、編集後の再分析にも再適用されます。

生成には固有名詞を除いた `GenerationBrief` だけを渡し、採用する高信頼属性、補助属性、避ける属性、探索属性、根拠IDを固定します。成人向け・暴力テーマは分析できますが、生成側では露骨な性的内容を拒否・再生成します。

推薦には固有名詞や原文を除いたプロフィール属性だけを渡します。LLM出力は構造検証後、同一作品、重複人物、プロフィールに存在しない根拠属性を除外し、4人未満なら結果全体を失敗にします。直近3回の表示候補だけは再選出を抑える目的で次回の推薦LLMへ渡します。

## テストと公開ゲート

```bash
npm run check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` はBiomeによるフォーマット、lint、import整理の差分を検査します。自動修正できる指摘は
`npm run check:fix`、フォーマットだけを適用する場合は `npm run format` を使用してください。

単体テストは集計の再現性、欠損、頻出と嗜好の分離、重複、作品偏り、矛盾、クラスタリング、完全一致根拠、推薦候補の品質境界、両providerの修復とfallbackを検証します。Playwrightはユーザー作成からアカウント削除までの主要導線を通します。

公開前の200件・人手二重ラベル評価はコードだけでは代替できないため、意図的に未達の公開ゲートとして残しています。[eval/README.md](eval/README.md) にデータ形式と実行方法があります。例示2件は評価器のsmoke test専用で、公開判定には使えません。

```bash
npm run eval -- eval/production-200.jsonl
```

全基準を満たさない限り評価コマンドは終了コード1になります。
