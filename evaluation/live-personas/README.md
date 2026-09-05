# 実API・永続DBでの人物別評価

通常のoffline E2Eと別に、起動済みの開発サーバー `http://localhost:5173` に接続します。実APIを使用し、登録データはDBへ残ります。分析器・プロンプト・公開API・DBスキーマは変更しません。

```bash
npm run dev
```

別のターミナルで実行します。既定出力先は `.artifacts/live-evaluation/20260905-personas-01/` です。別の測定には全コマンドで同じ `LIVE_RUN_DIR` を指定してください。開始前に開発サーバーを停止した状態で `.wrangler/state` を整合性を保ってバックアップし、認証設定を保持してください。

```bash
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

レビュー詳細APIでは好み候補の条件が省略されるため、条件の脱落を判定する際はプロフィール・エクスポートも照合します。完全に同文・同段階の主張の重複は原記録に残し、率へ重ねて加点しません。

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
