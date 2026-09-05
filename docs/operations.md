# 導入・運用

環境設定は [wrangler.jsonc](../wrangler.jsonc)、秘密値の項目は [.dev.vars.example](../.dev.vars.example) を正本にします。

## ローカル起動

Node.js 24とnpmを使用します。nvmを利用する場合は、リポジトリ直下で `nvm use` を実行してください。

```bash
npm ci
cp .dev.vars.example .dev.vars
# AUTH_PEPPERを十分に長いランダム値へ変更
npm run db:migrate:local
npm run dev
```

`http://localhost:5173`を開きます。リポジトリ内のローカル標準設定は`.dev.vars`のOpenAI／Cloudflare AI Gateway設定を使い、LLMは`gpt-5.6-luna`、Embeddingは`text-embedding-3-small`です。秘密値はbuild成果物から除外されます。

AI quotaを使わず全導線を確認する場合は次を使います。

```bash
npm run dev:offline
```

`offline`環境はLLMをReplay、EmbeddingをFakeへ明示的に切り替えます。Playwrightは専用portと毎回新しい一時D1を使い、既存serverや開発D1を再利用しません。通常起動時に失敗をFake成功へ置き換える暗黙fallbackはありません。

現行ローカルD1は`character-taste-lab-current-local`と専用local database IDを使います。migrationの正本は`database/migrations`です。

改修前との後方互換性は保証しません。DB定義は現行baselineと通常版／ダーク版のseedの3ファイルです。旧DB用の変換・コピー処理はありません。LLMジョブは `membership-v2` の割当と明示的な `effort`（モデル既定値はnull）が必要で、生成要求には `profileSnapshotId` が必須です。

## AI Provider

メンバーシップはベーシック／シルバー／ゴールド／プレミアムの4段階で、登録時と既存ユーザーはベーシックです。`LLM_TIER_ROUTES_JSON` にティア別の `{ provider, model }` と任意の `effort` を設定できます。初期値 `{}` は全ティアで共通モデルと推論量を継承します。共通の推論量は `LLM_REASONING_EFFORT`、fallback先は `LLM_FALLBACK_REASONING_EFFORT` で指定し、空欄ではモデルの既定値を使います。分析・生成ジョブに作成時のモデル・推論量を保存し、続行・再試行でも維持します。上位ティアの対象処理は自動fallbackせず、対象判定・Embedding・モデレーションは共通です。設定と用途一覧は[メンバーシップ実装](../worker/features/account/membership.ts) と [LLMルーティング](../worker/llm/routing.ts)を参照してください。

`LLM_PROVIDER`で次を明示選択します。

| 値 | 用途 |
|---|---|
| `workers_ai` | stagingまたは明示選択したCloudflare運用 |
| `openai` | local/productionのOpenAI Responses API。`store:false`とstrict JSON Schemaを使用 |
| `replay` | ローカルE2E／CIの再現可能な応答 |
| `fake` | 単体試験用の決定論的応答 |

OpenAIとWorkers AIの外部呼出しは、すべてCloudflare AI Gatewayを経由します。OpenAIを使う場合は`.dev.vars`またはCloudflare Secretへ`OPENAI_API_KEY`、`AI_GATEWAY_ACCOUNT_ID`、`AI_GATEWAY_TOKEN`を設定します。Gateway IDは`AI_GATEWAY_GATEWAY_ID`で指定し、Wrangler構成の既定値は`default`です。`AI_GATEWAY_TOKEN`にはCloudflareの`AI Gateway Run`権限が必要です。

OpenAI Responses APIのFlex Processingは`OPENAI_FLEX_ENABLED=true`の場合だけ`service_tier: "flex"`を送信します。既定値は`false`で、未設定または`false`の場合は`service_tier`を送信せず、OpenAI側の`auto`動作を使用します。

画面から入力され、LLMへ渡る自由記述は、保存・ジョブ作成より前にモデレーションします。`MODERATION_PROVIDER=openai`はAI Gateway経由でOpenAI Moderation API（既定モデル`omni-moderation-latest`）を使い、拒否時は該当入力欄とカテゴリを画面へ返して処理を終了します。Providerは専用interfaceの実装で切り替え可能です。外部APIを呼ばないoffline環境だけは`MODERATION_PROVIDER=fake`を明示指定します。

ローカルの`.dev.vars`例:

```dotenv
OPENAI_API_KEY=...
OPENAI_FLEX_ENABLED=false
MODERATION_PROVIDER=openai
MODERATION_MODEL=omni-moderation-latest
AI_GATEWAY_ACCOUNT_ID=...
AI_GATEWAY_TOKEN=...
```

preview／productionでは対象環境へ同じ値をSecretとして登録します。

```bash
npx wrangler secret put OPENAI_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_TOKEN --env production
```

Workers AIは`AI` bindingを使用しますが、各`env.AI.run()`へ同じGateway IDを渡すため、LLMとEmbeddingのログ・レート制限・利用量をAI Gatewayへ集約できます。Replay／Fakeは外部APIを呼ばないためGateway対象外です。

EmbeddingはLLMと独立した`EmbeddingProvider` Portを使います。local/productionのOpenAI `text-embedding-3-small`は1536次元、stagingのWorkers AI BGE-M3は1024次元です。OpenAI、Workers AI、Fakeの各Adapterをfactoryで切り替え、返却vectorの件数・順序・有限値・次元数を共通契約で検証します。

Providerのcapacity／429は`PROVIDER_CAPACITY_EXHAUSTED`、接続不能は`EXTERNAL_PROVIDER_UNAVAILABLE`としてJobへ保存します。retryable failureだけが、明示設定した`LLM_FALLBACK_PROVIDER`の対象です。

## Cloudflareへ配置する前に

1. staging／production用D1・private R2 bucket・Workflowを作成し、`wrangler.jsonc`のplaceholderを差し替える。
2. `AUTH_PEPPER`、`OPENAI_API_KEY`、`TURNSTILE_SECRET`を`wrangler secret`で登録する。
3. 各環境の`APP_ORIGIN`を実際のHTTPS originへ設定する。
4. Cron、R2 retention、Workflow binding、readinessを確認する。
5. `npm run db:migrate:staging`、`npm run deploy:staging`で検証してからproductionへ進める。

DB資産の再配置ではDDL・属性ID・保存データを変更しません。既存環境への適用やデプロイは別作業です。`db:migrate:remote` はproductionへ適用するコマンドであり、ローカル検証には使用しません。

## エクスポートと実行監視

エクスポートは `POST /api/v1/account/exports` で作成し、同じリソースのID配下で状態を確認します。readyになったファイルだけを所有者認証付きでダウンロードします。スキーマは4.0です。ジョブ失敗は状態・安全なエラーコードを確認して再試行します。

`/api/v1/health/live` は生存確認、`/api/v1/health/ready` はDB・設定・Embeddingを含む準備状態を返します。Outbox配送とlease回復は実行入口から行い、重複配送が発生してもジョブのclaimで排他します。

ビルドは `.dev.vars` が成果物に残らないよう `scripts/remove-build-secrets.mjs` を実行します。秘密値検査とバンドル検査を通過した成果物を配置します。
