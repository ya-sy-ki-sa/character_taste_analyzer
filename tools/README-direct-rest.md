# Worker不要版：ローカルからJevを呼び出す

構成：Codex → ローカルの `route-model.py` → Cloudflare REST API → `typesafe/jev`。
Jevの評価結果をローカルで検証し、固定ポリシーでモデルを選びます。
Workerの新規作成・デプロイ・Wrangler・TypeSafe APIキーは不要です。
旧 `jev-router.mjs` は今回の構成では使いません。

## 準備

1. CloudflareのAccount IDを確認します。
2. 対象アカウントに限定したAPIトークンを作成し、**Account > Workers AI > Read** 権限を付けます。
3. CloudflareのUnified Billingに利用可能なクレジットを用意します。Jevの料金はCodex Proとは別です。
4. `route-model.py` をプロジェクトの `tools/` に、`quota_optimizer.toml` を `.codex/agents/` に配置します。Python 3.11以上を使います。追加パッケージは不要です。

## 環境変数

必須：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`。
任意：`CLOUDFLARE_AI_GATEWAY_ID`。省略するとアカウントのデフォルトAI Gatewayを使用します。既存のGatewayを指定することもできます。
Workerは不要ですが、Cloudflare側のAI Gatewayと課金基盤は利用します。

Linux / WSL / macOSのbashで、トークンを履歴に残さず入力する例：

```bash
export CLOUDFLARE_ACCOUNT_ID='YOUR_32_CHARACTER_ACCOUNT_ID'
read -r -s -p 'Cloudflare API token: ' CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
```

PowerShell 7の場合：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'YOUR_32_CHARACTER_ACCOUNT_ID'
$secret = Read-Host 'Cloudflare API token' -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secret).Password
Remove-Variable secret
```

環境変数は、そのシェルから起動したプロセスへ渡されます。すでに起動済みのCodexには反映されません。Codexがツールを実行する環境にも設定してください。トークンをソースや状態JSONへ書かないでください。旧 `JEV_ROUTER_URL` / `JEV_ROUTER_TOKEN` は使用しません。

## 実行

```bash
python3 tools/route-model.py --example > state.json
python3 tools/route-model.py --state state.json
```

Windowsでは必要に応じて `python3` を `python` に読み替えてください。
`--state -` で標準入力も使用できます。`--offline` は通信せず既定ルールで判定します。

出力の `assessment_status: "ok"` がJev評価の取得成功を示します。
`fallback` の場合は `assessment_reason` を確認してください。`configuration_error` は環境変数、`http_401` / `http_403` は認証・権限、`http_429` はレート制限を確認します。課金・残高もCloudflare側で確認してください。
終了コード0はルート判定完了であり、API通信成功とは限りません。2は入力不正です。

このプロジェクトの `AGENTS.md` により、Codexは各依頼の開始時に `quota_optimizer` を自動で起動し、routing toolを実行します。毎回ユーザーがエージェントを指定する必要はありません。決定的なLuna max判定では、スクリプトがJevへの通信を省略します。

ルーターはモデルを推奨します。Codex側がモデル指定のworker起動に対応する場合はそのモデルで作業を委ね、対応しない場合は現在のモデルで続けます。認証情報が実行環境にない場合はJev評価がfallbackするため、Codexを再起動した後に確認してください。

## REST形式と維持した制御

接続先は固定の `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run`。
本文は `{"model":"typesafe/jev","input":{"state":{},"questions":{}}}` です。
認証はBearerトークン。キャッシュ・Gatewayログはリクエストヘッダーで無効化し、最大試行1回、Gatewayタイムアウト8秒を指定しています。ローカルのソケットタイムアウトは12秒です。

Jevの9項目のScore評価、Scoreのconfidence検証、Noulの0〜1検証、Scoreの重み付き合成、通信障害時のSol max代替判定、Astraの証拠・信頼度ゲートを実装しています。Jevにはモデル名を直接質問せず、指示・作業パッケージの機械性、曖昧さ、推論深度、アーキテクチャ範囲、制約密度、証拠統合、出力複雑度、言語ニュアンス、失敗影響を採点させます。候補は `Luna max → Sol low → Sol medium → Sol high → Sol max → Astra low → Astra medium → Astra high → Astra max` の順で、最終選択はコード側で行います。要約などのタスク情報はCloudflareとTypeSafeへ送信されます。

RESTの直接レスポンスと `result` ラッパーを検証し、不正形式やエラー応答では代替判定を使用します。トークンやプロバイダーの生エラー本文を出力しません。

## 検証範囲と公式資料

ローカルの模擬応答テストで、リクエスト形式・認証ヘッダー・レスポンス検証・通信障害・既存ルーティング条件を確認しています。実アカウントでのAPI接続・課金は未検証です。

- [Cloudflare REST API：認証、Gateway、ヘッダー](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [CloudflareのJev：モデル名と入出力形式](https://developers.cloudflare.com/ai/models/typesafe/jev/)

公式仕様の確認日：2026-09-19。
