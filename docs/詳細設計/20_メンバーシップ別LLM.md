# DD-20 メンバーシップ別LLM切り替え

## 方針と対象

新規登録時のユーザーはベーシック。内部値は `basic` / `silver` / `gold` / `premium`、表示名はベーシック／シルバー／ゴールド／プレミアムとする。通常版とダーク版で同じメンバーシップを使用する。初期設定は全ティアで共通モデルを継承し、モデルの実力・費用・待ち時間の比較は別途行う。

| 用途 | 選択 | 理由 |
|---|---|---|
| `character_understanding`, `dark_baseline_understanding`, `dark_character_understanding` | ティア別 | 資料の統合と人物・状態・主体性の解釈 |
| `customization_delta` | ティア別 | 元設定と変更内容の整合 |
| `understanding_audit`, `dark_understanding_audit` | ティア別 | 解釈を保持した訂正。理解処理と同じモデルを使う |
| `preference_analysis`, `dark_preference_analysis` | ティア別 | 好悪、反応経路、条件、価値判断の区別 |
| `preference_audit`, `dark_preference_audit` | ティア別 | 嗜好のニュアンスを保持した監査 |
| `preference_hypotheses` | ティア別 | 確認済み理解・既存嗜好・訂正を踏まえた仮説 |
| `character_generation`, `dark_character_generation` | ティア別 | 複数条件を満たす創作 |
| `generation_validation`, `generation_repair` | ティア別 | 意味的な制約検査と修正 |
| `generation_comparison` | ティア別 | 各案の一貫性・適合・差異の説明 |
| `dark_scope_assessment` | 共通 | 対象判定のモデルと基準を揃える |
| JSON形式修復 | 元処理を継承 | 内容を保持して修復する |

現在の形式修復はRemoteProvider内部で元リクエストを再実行する。型定義上の `schema_repair` を直接呼ぶ場合は `repairOfOperation` が必須。対象判定の形式修復は共通モデルを継承する。用途一覧は `llmOperationRouting` で網羅性を型検査する。

モデレーションとEmbeddingはティア共通。Wikipedia／Wikidata取得、根拠URL照合、プロフィール集計、グラフ、決定的な制約検証はLLM選択の対象外。画面表示、昇格API、課金、キー発行、ティア別利用回数制限は追加しない。

## 設定

`LLM_TIER_ROUTES_JSON` は任意のJSON object。指定できるキーは4ティアのみで、各値は `{ "provider": "openai|workers_ai|replay|fake", "model": "モデル名", "effort": "high" }`。`effort` は省略可能。モデル名は前後空白を除去し、空文字を拒否する。未知のキー・Provider、不正なeffort、部分的な接続先、JSON不正はreadinessエラー `LLM_TIER_ROUTES_INVALID` とする。APIキーなどの秘密値はこのJSONに含めない。

全環境の初期値は以下。各ティアが `LLM_PROVIDER` / `LLM_MODEL` / `LLM_REASONING_EFFORT` を継承する。

```json
{}
```

外部APIを呼ばない動作確認用の例。実モデルの推奨割当ではない。

```json
{
  "silver": { "provider": "fake", "model": "silver-test" },
  "gold": { "provider": "fake", "model": "gold-test" },
  "premium": { "provider": "fake", "model": "premium-test" }
}
```

未指定のティアは共通モデルを継承する。ベーシックも明示的に上書きできる。`dark_scope_assessment` はティア上書きを使わず共通モデルを選ぶ。上位ティアで利用する接続先も、APIキー・AI Gateway設定・Workers AI bindingのreadiness検査対象とする。モデルの実在や品質順位は推測せず、設定したモデルの適合性は運用時に評価する。

ベーシックと共通処理は、retryableな失敗に限り `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` を使用する。同一Providerの異なるモデルも代替にできるが、選択したprimaryと同一の接続先は除外する。シルバー以上のティア別処理はfallbackを無効とし、既存のジョブ再試行を使う。拒否・不正出力など非retryableな失敗を代替モデルへ回さない。OpenAIの `service_tier`（Flex等）はサービス側の処理方式であり、このメンバーシップとは独立する。

### 推論量（effort）

共通モデルには `LLM_REASONING_EFFORT`、フォールバック先には `LLM_FALLBACK_REASONING_EFFORT` を指定する。環境変数の未設定・空欄・空白のみはAPIへ送信せず、モデルの既定動作を維持する。`none` は明示的なAPI指定で、未設定とは区別する。初期値は全環境で空欄とする。

ティア全体を省略すると、共通設定のeffortも継承する。一方、ティアのprovider・modelを明示してeffortを省略した場合は、そのモデルの既定値を使用する。フォールバックも専用設定だけを使用し、primaryのeffortを継承しない。これにより異なるモデルへ未対応のeffortを自動適用しない。JSON内のeffortには空文字やnullを指定できず、既定値を使う場合はキー自体を省略する。

OpenAIには `reasoning: { effort }` として送信する。設定値は `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。モデルによって対応範囲が異なるため、モデル固有の対応値は[OpenAIの推論ガイド](https://developers.openai.com/api/docs/guides/reasoning)とモデル仕様で確認する。未対応の組み合わせに対するAPIの拒否を、別のeffortで再送したりfallbackしたりしない。

Workers AIでは、このアプリのeffort対応範囲を `@cf/openai/gpt-oss-120b` / `@cf/openai/gpt-oss-20b` の `low` / `medium` / `high` とし、Chat Completions形式の `reasoning_effort` で送信する（[Workers AIモデル仕様](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)、導入済み `@cloudflare/workers-types` の `ChatCompletionsCommonOptions` に準拠）。それ以外のモデル・値への明示指定は設定エラーとする。Fake／Replayは指定値を割当に保存するが、決定論的な応答は変更しない。

共通・フォールバックの不正値、未対応のWorkers AI設定、フォールバック先なしのeffort指定はreadinessエラー `LLM_ROUTES_INVALID` とする。ティア内の不正設定は `LLM_TIER_ROUTES_INVALID` とする。いずれも実行時にも検証し、不正設定で外部APIを呼ばない。モデレーションとEmbeddingにはeffortを適用しない。

## 保存・実行・API

現行baselineの `001_initial.sql` で `users.membership_tier`（NOT NULL、DEFAULT basic、4値のCHECK）と `jobs.llm_routing_snapshot_json` を定義する。ティアの権利判定はサーバーで取得したユーザー情報を `membershipTierForUser` へ渡す。将来の権利付与方式はこの境界に集約する。クライアントのティア・モデル指定を選択に使用しない。

新規登録・再解析・生成のジョブは作成batch内で割当を保存する。JSONの `policyVersion: membership-v2`、`membershipTier`、`common` / `tier` のprimary・fallbackは解決済みの値とし、秘密情報は含めない。ユーザー確認後の続行、追加質問・仮説、再試行、冪等リプレイは同じ割当を使用する。設定・ティア変更は新規ジョブから有効となる。

各primary・fallbackには `effort` を必須で保存する。モデル既定値を使う場合は明示的にnullとし、形式修復と再試行も保存済みの値を引き継ぐ。環境設定のeffort省略は新規ジョブ作成時にnullへ解決する。クライアントからeffortを指定するAPIは追加しない。

分析・生成ジョブには作成時の割当が必要。NULL割当は `LLM_JOB_ROUTING_REQUIRED`、旧policyVersion・effort欠落・不正JSONは検証エラーとし、現在設定から補完しない。

Workflowとローカルdispatcherはいずれも共通サービス入口で `createJobLlmProvider` を呼び、ジョブID・所有者IDで保存済み割当を取得する。下位ヘルパーにはこのProviderを明示的に渡し、リクエストやWorkflow payloadからモデル設定を受け取らない。実行時の認証情報はWorkerの現在のbindingを使用する。

登録（冪等リプレイを含む）・有効化・ログイン・`GET /api/v1/me` の `data.user` に `membershipTier` を追加する。既存セッションでもDB上の最新ティアを返す。ユーザーデータexportにも `membership_tier` を含める。ティアを変更するendpointは提供しない。

`model_run_metadata` のoperation・requested/resolved model・トークン・latencyに加え、`effective_settings_json.llmRouting` にティア、用途、元用途、`selectionReason: tier|common`、policyVersion、jobId、primary、fallbackを記録する。成功・失敗・形式修復・fallbackの各試行を保存する。Fake／Replayではrequested modelに設定値、resolved modelに実際の決定論的Adapter識別子を記録する。

`effective_settings_json.reasoningEffort` に各試行でAPIへ送信した推論量を記録し、未指定はnullとする。割当側のeffortも `llmRouting.primary` / `fallback` に残す。Fake／Replayでは実効値をnullとし、明示指定があれば `ignored_parameters_json` に `reasoningEffort` を記録する。

## 検証と適用順

- 新規ユーザーの既定値、CHECK制約、認証APIの実DB参照、クライアント指定による昇格防止。
- 4ティア×全用途の呼び分け、形式修復のモデル継承、設定不正、上位ティア専用の接続設定検査。
- 通常版・ダーク版で分析→確認→嗜好分析→仮説→生成・検査・比較を通し、ティア・設定変更後もモデルと記録が固定されること。
- 再解析が新しい割当を使用すること、割当未保存・旧形式の拒否と所有者分離、混雑時のfallbackと既存の3回上限。
- 型チェック、全単体試験、DDL・Schema・OpenAPI・prompt契約、build、既存E2E。

DBは現行baselineと通常版／ダーク版のseedで新規構築する。旧DBからの追加マイグレーションは提供しない。初回設定は `{}` とする。実モデルの比較・本番適用は別途実施し、今回の検証はFake／Replay・モックと一時DBで行う。
