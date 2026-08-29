# キャラ嗜好ラボ

好きなキャラクターを登録し、キャラクター像と「どこに・どう惹かれるか」を確認可能な根拠つきデータとして累積し、その嗜好からオリジナルキャラクターを作る日本語Webアプリです。React SPAとHono APIをCloudflare Workerで配信し、D1を正本にします。

詳細な設計と実装上の決定は[詳細設計書](docs/詳細設計/README.md)を参照してください。

## 実装済み

- UUIDアクセスキーによるユーザー作成、有効化、ログイン、セッション更新、キー変更、JSONエクスポート、全削除
- 既成、既成（カスタム）、オリジナルの3方式によるキャラクター登録
- 既成キャラクターはシステム側の公開情報検索、オリジナルキャラクターはユーザー入力の基本情報を起点とし、任意参考情報・ユーザー解釈を分離した基本像抽出
- カスタム登録における基本像と対象像の分離、改変・限定差分の構造化抽出
- キャラクター理解と嗜好候補の2段階確認
- 統制属性94件、44種類の反応経路、自由語、価値スタンス、根拠を分離した保存
- 同一キャラ・同一作品の偏りを補正する決定論的な累積嗜好プロフィール
- GraphProjectionのサーバー生成と、Graphology・ForceAtlas2 Web Worker・Sigma.jsによるブラウザ内探索／描画
- 固定ProfileSnapshot、項目選択、生成モード、改心／隠れた善性の方針を使うオリジナルキャラクター生成
- Workers AI、OpenAI Responses API、Replay、Fakeの明示的なProvider切替
- キャラクターdomainをD1 Adapterへ集約するDataStore Strategy（`DATASTORE_STRATEGY=d1`）
- CSRF、Origin、CSP、HMAC資格情報、日次quota、IP／ユーザーrate limit、所有者認可

悪、非道徳、残酷さ、善への無関心、改心しないこと、ヴィラン、端役、一場面限定も有効な嗜好として保持します。善悪、ヒーロー／ヴィラン、主役／端役を集計係数に使わず、フィクション上の好意から現実の人格や加害意図を推測しません。

## ローカル起動

Node.js 22以上とnpmを使用します。

```bash
npm install
cp .dev.vars.example .dev.vars
# AUTH_PEPPERを十分に長いランダム値へ変更
npm run db:migrate:local
npm run dev
```

`http://localhost:5173`を開きます。ローカル手動開発の標準はLLM／EmbeddingともWorkers AIで、`wrangler.jsonc`のremote AI bindingを使用します。Workers AIのquotaが尽きても入力とJob失敗理由はD1へ残ります。

AI quotaを使わず全導線を確認する場合は次を使います。

```bash
npm run dev:offline
```

`offline`環境は同じローカルD1に接続し、LLMだけをReplay、EmbeddingをFakeへ明示的に切り替えます。通常起動時に失敗をFake成功へ置き換える暗黙fallbackはありません。

旧アプリのローカルD1と混ざらないよう、新版は`character-taste-lab-v2-clean-local`と専用local database IDを使います。migrationの正本は`docs/詳細設計/database`です。

## AI Provider

`LLM_PROVIDER`で次を明示選択します。

| 値 | 用途 |
|---|---|
| `workers_ai` | ローカル手動確認とCloudflare運用。標準のローカルProvider |
| `openai` | OpenAI Responses API。`store:false`とstrict JSON Schemaを使用 |
| `replay` | ローカルE2E／CIの再現可能な応答 |
| `fake` | 単体試験用の決定論的応答 |

OpenAIを使う場合は`.dev.vars`またはCloudflare Secretへ`OPENAI_API_KEY`を設定し、`LLM_PROVIDER=openai`、`LLM_MODEL`を対象modelへ変更します。`OPENAI_TRANSPORT=ai_gateway`の場合は`AI_GATEWAY_ACCOUNT_ID`と`AI_GATEWAY_GATEWAY_ID`も設定します。

EmbeddingはLLMと独立した`EmbeddingProvider` Portを使います。ローカル標準はWorkers AI、productionは`EMBEDDING_PROVIDER=openai`、`EMBEDDING_MODEL=text-embedding-3-small`、`EMBEDDING_DIMENSIONS=1536`です。OpenAI、Workers AI、Fakeの各Adapterをfactoryで切り替え、返却vectorの件数・順序・有限値・次元数を共通契約で検証します。OpenAIのローカル動作確認は標準構成の変更ではなく、一時的なProvider上書きとして扱います。

Providerのcapacity／429は`PROVIDER_CAPACITY_EXHAUSTED`、接続不能は`EXTERNAL_PROVIDER_UNAVAILABLE`としてJobへ保存します。retryable failureだけが、明示設定した`LLM_FALLBACK_PROVIDER`の対象です。

## 検証

```bash
npm run check
npm run typecheck
npm test
npm run contracts
npm run build
npm run dev:offline
# 別terminalで
npm run smoke:e2e
npm run test:e2e
```

- 単体試験: Zod契約、カスタム差分の意味制約、LLM／Embedding Provider切替、Workers AI capacity保持、共通数値処理
- DDL契約: migration 3件、62テーブル、初期統制属性94件
- API smoke: 登録→理解確認→嗜好確認→プロフィール→グラフ→生成
- Playwright: 3方式登録画面と全主要導線、CSRF／Origin／水平権限／stored XSS、logout／session失効／account削除

Cloudflare Vite pluginがbuild出力へ`.dev.vars`を複製するため、全build scriptは終了時に`dist`配下を検査し、path検証済みの秘密artifactだけを削除します。`dist`に`.dev.vars`が残るbuildは失敗として扱ってください。

## 現在の実装境界

個人開発・デモ・少人数の無料枠検証に必要な縦断機能を先に実装しています。次は設計境界を保持した後続incrementです。

- R2への大容量資料upload、PDF／画像抽出
- Vectorizeを使う生成類似度検査
- assertion単位の訂正・却下と履歴比較UI
- original characterの部分修正revisionとfeedbackの嗜好候補化
- 非同期export／account deletion、Queue dispatcher、運用console
- 大規模GraphProjectionのcursor page、IndexedDB cache、neighbor API

未実装項目に必要なtable、schema、追加Adapter契約は詳細設計に含まれていますが、現在の画面で実装済みとは扱いません。キャラクターdomainのDataStore Strategy境界と初期D1 Adapterは実装済みです。

## Cloudflareへ配置する前に

1. staging／production用D1を作成し、`wrangler.jsonc`のplaceholder IDを差し替える。
2. `AUTH_PEPPER`、`OPENAI_API_KEY`、`TURNSTILE_SECRET`を`wrangler secret`で登録する。
3. production用Vectorize index `character-taste-text-embedding-3-small-1536`を1536次元で作成する。
4. 各環境の`APP_ORIGIN`を実際のHTTPS originへ設定する。
5. `npm run db:migrate:staging`、`npm run deploy:staging`で検証してからproductionへ進める。

既存データからのmigrationは、新規構築前提のため意図的に含めていません。
