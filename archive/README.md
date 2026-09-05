# 履歴資料

このディレクトリは現行仕様・実行対象から分離した履歴資料です。基準コミット: `983c3d892dfedab751dd4ebcb7360797d42f7557`。内容は当時のもので、現在の実装を説明するものではありません。

| 現在の配置 | 元の配置 |
| --- | --- |
| design | docs/詳細設計 の設計文書 |
| analysis | docs/分析器詳細 |
| quality.md | docs/品質改善.md |
| evaluations | docs/evaluations |
| mockups | ルートの mock-top-*.html |
| tooling | scripts/check-dark-eval.mjs |

評価JSONの内容は変更していません。レポート内のパス・ソースハッシュは実行当時のものです。過去文書の相対リンクやコマンドは当時の配置を前提としています。資料を再現する場合は上記コミットを参照してください。

実行用DB定義は `database/migrations`、現行の生成契約は `contracts/generated` へ移動しています。[現行文書](../docs/README.md)を起点に参照してください。

## 評価JSONの保管索引

基準コミットは上記と同じです。SHA-256は移動前後の一致確認に使用します。

| 保管先 | 元の配置 | SHA-256 |
| --- | --- | --- |
| [after-openai-v2.json](evaluations/quality/after-openai-v2.json) | `docs/evaluations/quality/after-openai-v2.json` | `4329c6051cd5d4be20c8aa30cc2aab4737ab19168a0f0be22c572e444e6f493e` |
| [after-openai-v3.json](evaluations/quality/after-openai-v3.json) | `docs/evaluations/quality/after-openai-v3.json` | `a5b2ed7816690040a034db6aa0184e72a5a2d704e47492641f8cb4dfe502c895` |
| [baseline-openai-v1.json](evaluations/quality/baseline-openai-v1.json) | `docs/evaluations/quality/baseline-openai-v1.json` | `83a945c2b24d87ef234dac28b5e84eed105351576cd3c5dfd9c0d177d80f13c1` |
| [generation-dark-openai-v2.json](evaluations/quality/generation-dark-openai-v2.json) | `docs/evaluations/quality/generation-dark-openai-v2.json` | `8b5977960712434eeb9a9c51f20593d0593acffee02deb6946dd4c9908972922` |
| [generation-dark-openai-v3.json](evaluations/quality/generation-dark-openai-v3.json) | `docs/evaluations/quality/generation-dark-openai-v3.json` | `b0f1da4198e81cbab0c7d3c5d645bd71d2672af01d3298aa82d4c2efbdd19f34` |
| [generation-dark-openai-v4.json](evaluations/quality/generation-dark-openai-v4.json) | `docs/evaluations/quality/generation-dark-openai-v4.json` | `f06c34bdf977e9f38998ee3917b7e0d9494ce571c369f0c663a35211e618f513` |
| [generation-openai-v2.json](evaluations/quality/generation-openai-v2.json) | `docs/evaluations/quality/generation-openai-v2.json` | `51db0650827f56d89dad8034a44458342005e422c08c9a62dd58aa39bf82f0d2` |
| [refinement-openai-v1.json](evaluations/quality/refinement-openai-v1.json) | `docs/evaluations/quality/refinement-openai-v1.json` | `192cf44c8eee61e87bcace532bc2943c110cb115311daf212a0984c6a1f00c85` |
| [refinement-openai-v2.json](evaluations/quality/refinement-openai-v2.json) | `docs/evaluations/quality/refinement-openai-v2.json` | `25c0fd5daa2f771a42a797ce912bedf3f395dc58d6a79dd3078c479097624d1a` |
| [similarity-openai-v2.json](evaluations/quality/similarity-openai-v2.json) | `docs/evaluations/quality/similarity-openai-v2.json` | `60e2732748698ce397ce8ce3d17830820b036b1411c73616aa58963918d7e75f` |
