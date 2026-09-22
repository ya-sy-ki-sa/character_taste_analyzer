# Jev中心の分析・生成

JevがChoice/Noul/Scoreで意味を判断し、コードが採否・保留・再検討を制御します。LLMは候補発見・命名・人物生成・難しい文脈の再検討を担当します。旧パイプライン、shadow実行、方式切替フラグはありません。

## 契約

- D1/R2、テーブル・制約、保存JSON、公開API、エクスポートを維持します。中間判定や機械順位は保存形式へ追加しません。
- Jevは文章を生成しません。引用の一致、ID/Pointer、件数、集計、保存はコードが検証します。
- 通常版とdark版の語彙・条件を分離します。人物の事実、ユーザーの好意、規範的な価値態度、自己経験を混同しません。
- ユーザー確認済みの内容を自動上書きせず、仮説を確認前の好みとして集計しません。
- 嗜好のstrength/confidenceは既存の意味を維持し、Jevの生確率で置換しません。
- Jevの記録をLLMのprovider/transportに偽装しません。実LLMの原出力とハッシュは保持します。

## 実行基盤

`worker/judgment` がCloudflare AI bindingのJev・Fake・Replayを実装します。通常は `JEV_PROVIDER=typesafe`、`JEV_MODEL=typesafe/jev`、`AI` binding、`AI_GATEWAY_GATEWAY_ID` が必要です。JevはCloudflareが提供するThird-party modelとして `env.AI.run("typesafe/jev", { state, questions }, { gateway: { id } })` から呼び出します。Jev専用のTypeSafe APIキー、Custom Provider、アカウントID、Gateway tokenは使用しません。offlineはReplay、試験はFakeを明示します。ローカルの判断fixtureは外部APIへ送信しません。

Choiceの候補・回答ID、分布のキーと合計、Scoreの段階とlegend、モデルID、利用量を検証します。欠落や不正応答は成功にしません。同一providerの通信は最大4並列、タイムアウト20秒、通信障害・429・5xxの再試行は最大2回です。Retry-Afterが内部待機上限を超える場合はジョブへ再試行可能な失敗を返します。

Cloudflare AI bindingの返却値は `state`・`result`・`gatewayMetadata` の外側を持つため、adapterで内側の `result` を取り出してから検証します。内側のモデルIDは要求名 `typesafe/jev` ではなく `jev-1.13.0` のような実行版になる場合があります。Choice/Scoreの確率は小数丸めで合計が1からわずかにずれるため、丸め誤差だけを許容して正規化します。`choice` と `score` は確率の最大値・期待値との完全一致を追加条件にせず、キー・範囲・分布・legendを検証し、確信度による採否はコード側の閾値で行います。

質問は関連文脈ごとにまとめます。リクエストのバイト数は制限しますがトークン数の正確な推定値とは扱いません。モデルのコンテキスト超過は明示的な失敗とし、原文の黙った切り捨ては行いません。

暫定閾値は `worker/judgment/policy.ts` が正本です。Choiceは選択確率0.90かつconfidence 0.80、Noulは0.90以上/0.10以下を明確な判断とします。日本語で校正済みの値ではありません。

## 不確実な判断

不足・矛盾は論点を限定して既存の割当LLMへ戻し、最大2巡補完します。修正後はJevで再検証します。未解決の人物理解・嗜好は既存レビューと不明点へ接続します。反応経路だけ不明な好みはnull経路で保持できます。

生成候補は必須・禁止条件の合格後に嗜好適合・整合性・候補間差異の順で比較します。重大違反を平均点で相殺しません。順位の確信が不足する場合はordinal順で既存比較画面へ渡し、推薦順位を確定的な好みとして扱いません。自動推薦ではselected_atを更新しません。

## 後工程の確認

型・lint・資産/契約整合性とは別に、単体・結合・Playwright・実モデルの意味品質を確認します。新方式のテストfixtureは実際のJevの精度を示しません。比較評価では主体、否定、条件、引用集合、抽出漏れ、dark文脈、保留率、生成の制約違反を確認します。

今回の実装では実APIの1ケース（`standard-narrative`）を実行してJev通信と分析完了を確認しました。デプロイは実行していません。後工程の実モデル比較は合計30米ドル上限です。Jev固有の詳細分布・判定履歴はローカル評価成果物へ記録し、既存アカウントエクスポートへ混入させません。

公式仕様: [Cloudflare Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/)、[AI Gateway Worker binding methods](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)、[AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)。
