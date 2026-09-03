# キャラ嗜好ラボ

好きなキャラクターを登録し、キャラクター像と「どこに・どう惹かれるか」を確認可能な根拠つきデータとして累積し、その嗜好からオリジナルキャラクターを作る日本語Webアプリです。React SPAとHono APIをCloudflare Workerで配信し、D1を正本にします。

詳細な設計と実装上の決定は[詳細設計書](docs/詳細設計/README.md)を参照してください。

## 実装済み

- UUIDアクセスキーによるユーザー作成、有効化、ログイン、セッション更新、private R2への非同期完全JSONエクスポート、全削除。キー紛失時の再発行・復旧は行わない
- 既成、既成（カスタム）、オリジナルの3方式によるキャラクター登録と、owner内identity候補のreuse/new選択
- 既成キャラクターはWikipedia・Wikidata・OpenAI Web Searchによる検証可能な公開情報検索、オリジナルキャラクターはユーザー入力の基本情報を起点とし、任意参考情報・ユーザー解釈を分離した基本像抽出
- カスタム登録における基本像と対象像の分離、改変・限定差分の構造化抽出
- キャラクター理解と嗜好候補の2段階確認
- 統制属性94件、44種類の反応経路、自由語、価値スタンス、検証状態・JSON Pointer付き根拠を分離した保存
- 同一キャラ・同一作品の偏りを補正する決定論的な累積嗜好プロフィール
- GraphProjectionのサーバー生成と、Graphology・ForceAtlas2 Web Worker・Sigma.jsによるブラウザ内探索／描画
- 固定ProfileSnapshot、項目選択、生成モード、不要な道徳補正を自動追加しない内部方針、決定的・意味的制約検査を使うオリジナルキャラクター生成
- Workers AI、OpenAI Responses API、Replay、Fakeの明示的なProvider切替
- キャラクターdomainをD1 Adapterへ集約するDataStore Strategy（`DATASTORE_STRATEGY=d1`）
- 世代フェンス、D1 outbox、lease付き再配送、profile/graphの原子的cutover
- CSRF、必須Origin、64 KiB body limit、CSP、HMAC資格情報、冪等quota予約、IP／ユーザーrate limit、所有者認可

悪、非道徳、残酷さ、善への無関心、改心しないこと、ヴィラン、端役、一場面限定も有効な嗜好として保持します。善悪、ヒーロー／ヴィラン、主役／端役を集計係数に使わず、フィクション上の好意から現実の人格や加害意図を推測しません。

## ローカル起動

Node.js 24 LTSとnpmを使用します。nvmを利用する場合は、リポジトリ直下で `nvm use` を実行してください。

```bash
npm install
cp .dev.vars.example .dev.vars
# AUTH_PEPPERを十分に長いランダム値へ変更
npm run db:migrate:local
npm run dev
```

`http://localhost:5173`を開きます。ローカル標準は`.dev.vars`のOpenAI／Cloudflare AI Gateway設定を使い、LLMは`gpt-5.6-luna`、Embeddingは`text-embedding-3-small`です。秘密値はbuild成果物から除外されます。

AI quotaを使わず全導線を確認する場合は次を使います。

```bash
npm run dev:offline
```

`offline`環境はLLMをReplay、EmbeddingをFakeへ明示的に切り替えます。Playwrightは専用portと毎回新しい一時D1を使い、既存serverや開発D1を再利用しません。通常起動時に失敗をFake成功へ置き換える暗黙fallbackはありません。

現行ローカルD1は`character-taste-lab-current-local`と専用local database IDを使います。migrationの正本は`docs/詳細設計/database`の2つのbaselineです。

## AI Provider

`LLM_PROVIDER`で次を明示選択します。

| 値 | 用途 |
|---|---|
| `workers_ai` | stagingまたは明示選択したCloudflare運用 |
| `openai` | local/productionのOpenAI Responses API。`store:false`とstrict JSON Schemaを使用 |
| `replay` | ローカルE2E／CIの再現可能な応答 |
| `fake` | 単体試験用の決定論的応答 |

OpenAIとWorkers AIの外部呼出しは、すべてCloudflare AI Gatewayを経由します。OpenAIを使う場合は`.dev.vars`またはCloudflare Secretへ`OPENAI_API_KEY`、`AI_GATEWAY_ACCOUNT_ID`、`AI_GATEWAY_TOKEN`を設定します。Gateway IDは`AI_GATEWAY_GATEWAY_ID`で指定し、Wrangler構成の既定値は`default`です。`AI_GATEWAY_TOKEN`にはCloudflareの`AI Gateway Run`権限が必要です。

OpenAI Responses APIのFlex Processingは`OPENAI_FLEX_ENABLED=true`の場合だけ`service_tier: "flex"`を送信します。既定値は`false`で、未設定または`false`の場合は`service_tier`を送信せず、OpenAI側の`auto`動作を使用します。

ローカルの`.dev.vars`例:

```dotenv
OPENAI_API_KEY=...
OPENAI_FLEX_ENABLED=false
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

## 検証

```bash
npm ci
npm run verify
```

- 単体試験: Zod契約、カスタム差分の意味制約、LLM／Embedding Provider切替、Workers AI capacity保持、共通数値処理
- DDL契約: migration 6件、66テーブル、初期統制属性94件
- as-built OpenAPI、Zod/JSON Schema、prompt hash、bundle budget、secret scan
- coverage: deterministic core全体80%/branch 75%、状態・quota・provenance・generation validatorはbranch 90%
- API smoke: 登録→理解確認→嗜好確認→プロフィール→グラフ→生成
- Playwright: 3方式登録画面と全主要導線、CSRF／Origin／水平権限／stored XSS、logout／session失効／account削除
- 現行unitは15ファイル・102テスト。ローカルE2EはChromium全7件、Firefox smoke、mobile smokeの計9件を確認済みです。WebKit smokeはCIの`--with-deps`環境で必須実行します。

Cloudflare Vite pluginがbuild出力へ`.dev.vars`を複製するため、全build scriptは終了時に`dist`配下を検査し、path検証済みの秘密artifactだけを削除します。`dist`に`.dev.vars`が残るbuildは失敗として扱ってください。

## ライセンス

本プロジェクトのソースコードは[MIT License](LICENSE)で公開します。利用している依存パッケージにはそれぞれのライセンスが適用され、Webサイトのトップ画面から[サードパーティライセンス一覧](public/third-party-licenses.html)を確認できます。

## 現在の実装境界

P0〜P2の縦断機能を実装済みです。`AUTH-01`は仕様として現状維持し、次はP3または別途判断が必要な後続incrementです。

- R2への大容量資料upload、PDF／画像抽出
- Embedding Providerを利用した生成類似度検査（保存先は未実装）
- assertion単位の訂正・却下と履歴比較UI
- original characterの部分修正revisionとfeedbackの嗜好候補化
- public visibility/consent、運用console
- 大規模GraphProjectionのcursor page、IndexedDB cache、neighbor API

現行のデータ契約は46テーブルのbaseline DDLへ統合済みです。キャラクターdomainのDataStore Strategy境界とD1 Adapterは分離して実装しています。

## Cloudflareへ配置する前に

1. staging／production用D1・private R2 bucket・Workflowを作成し、`wrangler.jsonc`のplaceholderを差し替える。
2. `AUTH_PEPPER`、`OPENAI_API_KEY`、`TURNSTILE_SECRET`を`wrangler secret`で登録する。
3. 各環境の`APP_ORIGIN`を実際のHTTPS originへ設定する。
4. Cron、R2 retention、Workflow binding、readinessを確認する。
5. `npm run db:migrate:staging`、`npm run deploy:staging`で検証してからproductionへ進める。

ローカルD1は現行baselineへside-by-side移行・検証済みです。remote resourceの作成・deployは実施していません。
