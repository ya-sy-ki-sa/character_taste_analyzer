# 実API・永続DBでの人物別評価

通常のoffline E2Eと別に、起動済みの開発サーバー `http://localhost:5173` に接続します。実APIを使用し、登録データはDBへ残ります。分析器・プロンプト・公開API・DBスキーマは変更しません。

```bash
npm run dev
```

別のターミナルで実行します。全コマンドで同じ `LIVE_RUN_DIR` を明示指定してください。未指定と、`final-artifact-manifest.json` のある完了済みrunへの書き込みは拒否します。開始前に開発サーバーを停止した状態で `.wrangler/state` を整合性を保ってバックアップし、認証設定を保持してください。

```bash
export LIVE_RUN_DIR=.artifacts/live-evaluation/20260906-personas-01
npm run eval:personas:freeze
npm run eval:personas:run
LIVE_PHASE=baseline npm run eval:personas:run
LIVE_PHASE=export npm run eval:personas:run
```

`pilot` は各人の第1ケース、`baseline` は保存した進捗を照合して残りを登録します。確認前の出力は上書きしません。ネットワーク断の再開時も、既存登録を作品・媒体・範囲・理由まで照合し、曖昧な一致では保存を止めます。retryableな解析失敗への追加再試行は1回です。

認証のトレース・動画は無効です。アクセスキーは発行直後、有効化前に `accounts.json` へ所有者のみ読み書きできる状態で保存します。報告書にキーを転載しないでください。Turnstileは設定済みの公式テスト用キーを使います。LLM・Embedding・Moderationの実APIとは独立しています。

採点補助は固定入力・期待要素・出典メモをアプリへの入力と分離して処理します。補助出力は最終採点ではなく、`codex-review.json` の根拠付き再点検を重ねます。補助APIの使用量は本測定のモデル呼出数から分けて保存します。

```bash
node scripts/watch-live-persona-grading.mjs
node scripts/report-live-personas.mjs
```

固定シードの再採点対象は `second-pass-selection.json` に保存します。`LIVE_GRADING_PASS=second node scripts/grade-live-personas.mjs` は初回採点を渡さず別パスの採点補助を実行します。Codexが不一致を原文・出典で裁定して `second-pass.json` を作成します。`node scripts/audit-live-persona-profiles.mjs` は5→10→15件の保持数、条件、グラフ世代、作品構成を読み取り専用で集計します。

現行レビュー詳細APIには好み候補の条件・元表現があります。旧記録では省略されるため、条件の脱落を判定する際はプロフィール・エクスポートも照合します。欠損を空条件と読み替えません。完全に同文・同段階の主張の重複は原記録に残し、率へ重ねて加点しません。

初回60件と4人分のエクスポート保存後、Codexが `correction-plan.json` で代表例を選択します。`correction-start` で再生成を保存し、各 `corrections/<case-id>/edits.json` に再生成結果を読んだ上で訂正内容を指定します。次の2段階でUIから訂正・確認を実行します。

```bash
LIVE_PHASE=correction-start npm run eval:personas:run
LIVE_PHASE=correction-understanding npm run eval:personas:run
LIVE_PHASE=correction-preference npm run eval:personas:run
LIVE_PHASE=verify npm run eval:personas:run
node scripts/audit-live-persona-corrections.mjs
LIVE_FINAL=1 node scripts/report-live-personas.mjs
```

最終報告には、Codexが根拠を確認して作成した `report-findings.json`、`profile-review.json`、`second-pass.json`、`codex-review.json` と、4人分の初回・終了時エクスポートが必要です。訂正の追加観測は `correction-issues.json` に保存し、初回60件の点数へ混ぜません。今回の個別訂正内容・代表例選択はrun内のファイルに固定されているため、別データの測定でそのまま流用しないでください。

`repair-pilot` は20260905測定で初期選択欄を外し損ねたA01を同じ登録内で復旧した専用工程です。一般の再実行には使いません。条件外の2版を除外し、本測定は第3版を採用しました。自動化の不具合とアプリの測定結果は区別して報告します。

## 同じ60件の再評価・比較

20260906測定は旧ローカルDBのseed履歴が現行migrationと衝突したため、run専用の永続状態を使用します。ローカルDBを上書きせず、新しい空の保存先へ現行migrationを適用します。起動前に既存5173番サーバーを停止してください。

```bash
npx wrangler d1 migrations apply character-taste-lab-current-local --local --persist-to "$LIVE_RUN_DIR/runtime-state" --config wrangler.jsonc
E2E_STATE_PATH="$LIVE_RUN_DIR/runtime-state" npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`E2E_STATE_PATH` はViteの永続保存先だけを指定します。`CLOUDFLARE_ENV=offline` は付けず、LLM・Embedding・Moderationを実プロバイダーのまま使用します。通常のoffline E2Eは従来の専用環境で実行します。

開始前に `comparison-protocol.json` へ比較元・固定入力ハッシュ・追加評価基準を保存します。前回と同じ採点指示・12件の別パス対象を使用し、追加の候補保持・条件・人物理解評価は `supplementary-review.json` に前後の原出力を根拠として記録します。要約だけの保持をプロフィール反映の成功へ読み替えません。

訂正の対象IDと操作は今回の再生成出力を読んで指定します。`correction-review.json` の `cases[caseId].note` と `issues` に確認した説明・追加指摘を保存できます。訂正監査は保存済み操作から根拠あり・根拠0件・未取得・情報不足の分類を別々に集計し、前回の観測文を引き継ぎません。

採点・Codex再点検後、`comparison-findings.json` の `paragraphs` と `issues`（`caseIds`・`verdict`・`reason`）へ比較の解釈を記録し、次を実行します。

```bash
node scripts/compare-live-personas.mjs \
  --baseline .artifacts/live-evaluation/20260905-personas-01 \
  --current "$LIVE_RUN_DIR" \
  --output "$LIVE_RUN_DIR/comparison"
```

比較CLIは入力・ケース順・設定・実モデル・採点指示の一致を検査し、全体と共通評価対象の件数・分母・率・ポイント差をHTML／Markdown／CSV／JSONへ出力します。比較元への書き込みと既存出力先の上書きを拒否します。原出力がないリンクは「未取得」と表示します。最終manifestは報告書と比較成果物を確認してから保存してください。

## 事前指定した部分集合の評価

`LIVE_CASES` を固定時に指定すると、元の60件を検証した後、指定ケースだけのdatasetと `selection.json` を凍結します。IDは元の順序で指定してください。入力本文・採点基準・出典メモは変えません。実行・採点・報告は凍結したdatasetの件数を使います。

```bash
export LIVE_RUN_DIR=.artifacts/live-evaluation/20260906-grounding-02
LIVE_CASES=A01,A02,A07,A08,A12,A13,A14,B03,B15,C02,C05,C11,C12,C14,C15,D02,D03,D10 npm run eval:personas:freeze
npm run eval:personas:run
LIVE_PHASE=baseline npm run eval:personas:run
LIVE_PHASE=export npm run eval:personas:run
LIVE_PHASE=verify-subset npm run eval:personas:run
```

pilotは各人の選択された最初のケースです。`verify-subset` は再ログイン・選択件数・最終プロフィール・エクスポートを確認します。この部分集合評価では手動訂正を実施しません。offlineの訂正回帰テストと混同しないでください。

比較には `--cases` で同じID列を明示します。元のdataset・入力・ケース順・設定を検証し、前回を読み取り専用のまま選択ケースへ絞ります。通常の比較で異なるdatasetを許す変更ではありません。前回60件分の使用量を18件分と表示せず、帰属できたモデル記録だけを別集計します。累積プロフィールの数値は前回15件時点と比較しません。
