# テスト・品質評価

## 品質ゲート

`npm run verify` はformat、lint、TypeScript、coverage付きテスト、生成契約、アーキテクチャ、ライセンス、build、秘密値検査、バンドル予算、E2Eを実行します。[CI](../.github/workflows/verify.yml)も同じコマンドを使用します。

TypeScriptは `tsconfig.browser.json`（DOM）、`tsconfig.worker.json`（Workers）、`tsconfig.tools.json`（Node・テスト・E2E・開発設定）で検査します。VitestはbrowserプロジェクトのjsdomとserverプロジェクトのNodeを分けます。SQLite/D1補助は [tests/support/database.ts](../tests/support/database.ts) に集約し、すべて現行DDLとseedを適用して外部キーを有効にします。batchはロールバックと直列化を含む実装です。

重点検証は所有者・ドメイン分離、冪等性、重複配送、途中失敗、leaseと再試行、古い世代、一括更新のロールバック、レビュー根拠、生成の採用・評価です。HTTPの実レスポンスは共有スキーマで検証し、APIテストは通常版・dark版の両ルートを通します。

Playwrightは毎回専用の一時D1と41737番ポートを使います。開発用D1と既存サーバーを再利用しません。Chromiumは全導線、Firefox・mobileはsession smoke、WebKitはホスト依存ライブラリがある場合に実行します。CIでは3エンジンを `--with-deps` でインストールします。

## 生成資産と依存関係

- `assets:generate`: カタログ、ルート登録、共有Zod、プロンプトregistryから生成。
- `assets:check`: ファイルを書き換えず、生成結果と保存済み資産の一致を検査。
- `contracts`: 上記とDDL、JSON Schema、OpenAPIの登録一致を検査。
- `architecture:check`: 実行時の循環依存、逆向きの依存、実装からアーカイブ・テストへの参照、リポジトリ外のSQLを検査。
- `licenses:generate` / `licenses:check`: lockfileから配布対象ライセンスを生成・検査。

OpenAPI・JSON Schema・プロンプト情報の出力先は [contracts/generated](../contracts/generated)。検査に更新フラグを渡す方式は使用しません。

## 評価の実行と解釈

```bash
npm run eval:quality -- --output .artifacts/evaluations/run.json --provider fake --generate
npm run eval:quality -- --output .artifacts/evaluations/subset.json --limit 4
```

同名の出力は上書きしません。実プロバイダーを明示した場合だけ外部LLMを使用します。ケース数はfixtureから取得します。対象IDは `--only id1,id2`、比較は `--compare baseline.json` で指定できます。

現行レポートは [evaluation/report.ts](../evaluation/report.ts) のスキーマ2.0です。実際に取得したレビュー、候補、検証記録、モデル実行情報を検査します。分析ケースのerrorと、生成結果がgeneratedでない場合・候補が空の場合を失敗として扱い、CLIは終了コード1を返します。生成を要求したケースは生成結果または明示したスキップ理由が必要です。好みの根拠がないケースの生成スキップは成功した生成件数には入りません。

反応経路の一致率、根拠の帰属率は観測可能な指標です。測定対象がない場合はnull。意味的な正確性、不要な善化、主体性の混同は、この指標だけで合格と判定しません。ユーザー訂正率・採用率は実際のユーザー行動が必要なためnullです。Fake/Replayの通過は実モデルの精度を証明しません。

比較はスキーマ・fixture version・provider・modelとケースのID/順序を検査します。過去の1.0形式は読み替えません。[archive/evaluations](../archive/evaluations) の原本は当時の出力のまま保持します。現行出力と接続していなかった旧darkゲートも [履歴](../archive/tooling/check-dark-eval.mjs) として保管しています。

## バンドルと画面

Viteのmanifestと `build-dependencies.json` を使用して、実際の静的依存をたどります。ファイル名の正規表現でmain/graphを推測しません。初期読み込み、各遅延画面、グラフ、すべてのCSSのgzip合計を [check-bundle-budget.mjs](../scripts/check-bundle-budget.mjs) で検査します。初期読み込みへのサーバー・Zod・グラフエンジン混入も失敗にします。

通常版・dark版を1440×1000、1366×768、390×844、320×720で比較します。モーダル、フォーカス復帰、Escape、入力エラー、長文、横はみ出し、モーション軽減を含めます。今回の基準・結果は[改修検証記録](refactor-validation.md)にまとめます。

## 反応経路が未確定の明示的な好み

嗜好候補の `responseChannel: null` は「反応経路未確定」です。対象・理由が具体的なら既存の生成・監査2回で候補を保持し、確認後に属性・条件の集計へ含めます。経路不明による確信度の減額は行いません。曖昧な好意だけなら要約と質問に残します。経路だけの編集は `set_response_channel` を使い、引用・文脈・強度・確信度を引き継ぎます。無効根拠を有効化する操作ではありません。

リリース時は `004_nullable_preference_channel.sql` をアプリ更新より先に適用してください。既存レコードの自動再解析・過去評価の上書きは行いません。旧NOT NULLスキーマへのロールバックは、null候補が保存された後には適用できません。

[固定fixture](../tests/fixtures/explicit-preferences.json)の入力は `.artifacts/live-evaluation/20260905-personas-01/cases/{ID}/preference-before.json` から取得しました。A07・B05・C02・C10・D02、対照例A12・C05、曖昧例B03・C03・D03を含みます。`expectedAssertions` は改善後に保持すべき内容として人手で定義した期待値で、実モデルが返した出力ではありません。[パイプラインテスト](../tests/explicit-preference-pipeline.test.ts)は固定応答の保存・引用検証・レビュー・プロフィール・生成briefへの伝達と呼出数を検証します。B05の価値態度だけを、好みの抽出成功とは数えません。

実モデルの取りこぼし改善は、このテストだけでは実証しません。実APIで再評価する際は別出力先を使用し、候補件数に加えて、対象・引用・条件・否定と未確定経路の保持をfixtureの期待内容と照合してください。`preferenceAssertionCount`、`valueStanceAssertionCount`、`unresolvedResponseChannelCount` は生成時の品質情報であり、意味的な抽出正確性を表す指標ではありません。
