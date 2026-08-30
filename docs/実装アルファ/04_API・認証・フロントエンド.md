# API・認証・フロントエンド

## 1. アクセスキーを失う操作を作らない

### 新規登録

pending user 作成後のアクセスキーは一度だけ表示されますが、共通 Modal は backdrop click、Escape、閉じるボタンで閉鎖できます（`src/components/Ui.tsx:82-130`, `src/pages/Landing.tsx:237-280`）。閉じた後に同じ activation を再開するための key/idempotency 情報は component memory にしかありません。

pending username は一意制約を保持したままで、設計にある期限後 cleanup も実装されていません。利用者はキーを失ったうえ、同じ username を再利用できない状態になり得ます。

### ローテーション

設定画面のローテーションは API 成功時に旧 credential と session を即座に失効させ、その後で新キーを dismiss 可能な Modal に表示します（`worker/index.ts:440-473`, `src/pages/SettingsPage.tsx:109-186`）。表示直後にタブを閉じる、コピー前に Modal を閉じる、clipboard が失敗する、といった通常操作で唯一の credential を失います。

### 推奨フロー

- キー表示 dialog は「保存した」に明示チェックするまで backdrop/Escape/close を無効にする。
- 新規登録に既にある copy/download/手動確認を維持し、ローテーションにも同じ保存手段を持たせる。copy 成功だけを保存確認にはしない。
- ローテーションは新 credential を pending として発行し、新キーでの確認後に旧キーを失効させる。
- 一定時間の overlap または cancel を用意する。overlap 中の両キーは audit できるようにする。
- recovery code や管理者回復を提供しない方針なら、回復不能であることを request 前に明示する。
- pending user の expiry、解放時刻、同一 username の再登録条件を決め、定期 cleanup する。
- activation expiry は設計どおりの安定した HTTP/error code にする。

Modal の閉鎖制御は呼び出し側の `dismissible` property にし、一般的な情報 Modal と credential ceremony を同じ挙動にしない方がよいです。

## 2. Origin 検査を契約どおりにする

`csrfMiddleware` は Origin が存在して不一致のときだけ拒否し、Origin 欠落は通します（`worker/auth.ts:118-129`）。SameSite Strict cookie は有力な防御ですが、詳細設計の「unsafe method では Origin 必須」と実装が一致しません。

推奨:

- browser session を使う POST/PUT/PATCH/DELETE は Origin 必須にする。
- `APP_ORIGIN` と完全一致させ、staging/production の空文字を起動時に拒否する。
- request origin を暗黙の許可 origin にする fallback は local development のみに限定する。
- CLI/API client を許可するなら、session cookie と別の credential/CSRF policy を持つ route として明示する。
- missing、`null`、malformed、scheme/port 違い、proxy headers の契約テストを追加する。

## 3. 重要なプライバシー説明が実装と一致していない

設定画面は「モデルの作品知識や外部検索を分析根拠にしません」と表示します（`src/pages/SettingsPage.tsx:57-66`）。実装は character analysis でモデル知識を分類し、Wikipedia 調査と OpenAI hosted search を使います。したがって現状の文言は、単なる表現差ではなく処理内容の説明不一致です。

公開前に、少なくとも以下を利用者が読める場所へ出してください。

- どの入力が LLM provider へ送られるか。
- OpenAI / Workers AI 等、環境で変わる処理先。
- system research と hosted search を行う条件、参照先、利用者が無効化できるか。
- model knowledge、利用者資料、外部資料をどう区別して表示するか。
- provider 側保存を抑制する設定と、それでも残る運用上の境界。
- 本サービス側の保持期間、削除、export の範囲。

`store: false` の実装は維持すべき良い点ですが、それだけを「保存されない」と一般化しないよう注意が必要です。処理先や提供条件が変わるため、最終文言は実際のデプロイ構成と適用規約を確認して確定してください。

## 4. エクスポートの約束と実データが違う

設定画面は「入力、分析プロフィール、生成履歴」をまとめて書き出すと説明します。一方、`/api/v1/account/export` は Entry の一覧要約、current profile、generation の一覧を返すだけです（`worker/index.ts:476-490`）。少なくとも次を欠きます。

- 入力 draft の全フィールドと source text
- Entry revision と review 履歴
- character/preference assertion と evidence
- profile/graph の過去 snapshot
- generation brief/result/coverage/conflict
- model run、provider/model、prompt/schema version
- account/consent/audit metadata

二つの選択肢があります。

1. 現行 UI を「概要を書き出す」に変更する。
2. portability 用 export job を作り、version 付き archive と manifest/checksum を生成する。

本システムの価値が分析の再利用にあるなら、2を推奨します。export を import 可能な論理 schema にしておくと、バックアップと将来 migration の検査にも使えます。

## 5. Landing の機能説明を現行境界に合わせる

Landing は「原文から追跡できる」「評価から分析がさらに育つ」と読める表現をしています（`src/pages/Landing.tsx:38-49`, `:88-105`）。前者は現在の evidence locator では保証できず、後者の feedback 学習は現行実装の境界外です。

次のラベルを分けると誤解が減ります。

- 利用可能: 登録、レビュー、profile、条件付き生成。
- 試験提供: system research、graph、LLM 根拠抽出。
- 未実装/予定: feedback による補正、similarity、完全 export 等。

また「分析結果は仮説であり、利用者が確認して初めて profile に反映される」という現在の良い設計を Landing でも明確にすると、LLM の断定感を抑えられます。

## 6. request body と error contract

API middleware の 64 KiB 制限は、数値の `Content-Length` が存在し閾値を超えた場合だけ早期拒否します（`worker/index.ts:91-96`）。header 欠落、chunked、不正値では body parser が先に大きな body を読む可能性があります。field 単位の Zod 上限はありますが、巨大な不正 JSON の buffer 抑制にはなりません。

- CDN/Worker と application の両方で実効 body 上限を揃える。
- body を読む際の上限超過を安定した 413 envelope へする。
- gzip 等の圧縮 body を許す場合は展開後上限も決める。

また、Zod validator の標準エラーが共通 error envelope を常に通ることを API contract test で確認してください。OpenAPI、フロント API client、実 route で code/status/details の形を一つにする必要があります。

## 7. health/readiness と設定表示

現在の health は embedding provider の生成を主に確認し、D1 query、LLM primary/fallback の必須 credential、Turnstile、APP_ORIGIN、Workflow binding の実効状態を十分に検証しません（`worker/index.ts:113-125`）。誤設定でも `ok` になり得ます。

推奨する分割:

| endpoint | 用途 | 内容 |
|---|---|---|
| liveness | process が応答可能か | 外部依存なし、安価 |
| readiness | request を安全に受けられるか | env validation、D1 軽量 query、必要 binding、schema version |
| diagnostics（非公開） | 運用調査 | provider/model/fallback、dimension、outbox lag、projection freshness |

外部 LLM への実 call を毎 health check で行う必要はありません。起動時の構成検証と、別の低頻度 canary を分ける方がコストと障害切り分けに適します。

## 8. UX とアクセシビリティ

### Modal

共通 Modal は `role="dialog"`、dialog への初期 focus、閉鎖後の focus 復帰を実装しています。一方、focus trap と背景の inert 化はなく、Tab 操作が背面へ抜け得ます。credential dialog の dismissibility と合わせて直すべきです。

### Graph

可視グラフは関係把握に有効ですが、キーボードだけで node/edge を探索できる同等手段が必要です。dimension、stance、condition、evidence を filterable table/list でも表示し、graph は補助表現にします。

### Form label

E2E では `/作品名/` という accessible label が複数要素に一致しました。説明文中の語が accessible name に混入しないよう、`label`/`aria-describedby` を見直し、テストも exact label を使います。

### 失敗時の回復

- 分析、profile rebuild、generation の retryable/permanent を表示する。
- queued/running が長時間停滞したときの再同期を用意する。
- profile/graph が stale なら「最新」ではなく更新中と明示する。
- clipboard/download 失敗、offline、二重送信を標準シナリオに含める。

## 9. クライアント性能と静的配信

ビルドは成功しましたが、main client JS が 512.35 kB（gzip 146.04 kB）で Vite の 500 kB 警告を超えました。Profile/graph 系依存が初期 chunk に入る構成です。

改善順:

1. route 単位で `React.lazy` / dynamic import。
2. graph 可視化を Profile 画面内でも遅延ロード。
3. bundle analyzer と gzip/brotli budget を CI へ追加。
4. hash 付き asset は `immutable`、HTML は再検証する cache header を `_headers` で明示。
5. static document に HSTS を直書きするかは配信構成によるため、独自 domain/HTTPS 固定後に zone-level 設定を確認する。

## 10. 公開ユーザー検索の製品判断

公開ユーザー検索は空 query でも最大50件を返し、username の public/private 切替 UI はありません。Landing は「公開されるのはユーザー名だけ」と説明しますが、一覧 UI 自体が公開 ID の先頭も表示しています（`src/pages/Landing.tsx:73-85`）。小規模アルファでは機能しますが、表示説明を実データへ合わせ、利用者一覧性と発見可能性は別の同意として扱う方が安全です。

- 登録時の初期値と説明を明示する。
- username 非公開でも共有リンクだけ許可するモードを検討する。
- empty query の列挙を許すか、prefix 最小長を要求する。
- block/report を実装する段階で search visibility も一緒に扱う。
