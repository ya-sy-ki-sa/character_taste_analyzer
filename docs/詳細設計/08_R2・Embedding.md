+# DD-08 R2・Embedding境界

## 1. 現行責務

現行のR2 bindingは`EXPORTS`だけであり、account exportのprivate JSON objectを保持する。Entryの参考情報、抽出結果、Profile、Graph、生成JSONの正本はD1である。資料upload用R2 bucketやVectorize bindingは存在しない。

export object keyは推測困難なIDを使い、username、作品名、キャラクター名を含めない。取得前にD1の`account_exports.owner_user_id`とsession所有者を照合し、R2 metadataだけで認可しない。期限切れまたはaccount削除時はobjectを削除する。

## 2. Embedding Provider

Embeddingのpolymorphic boundaryはOCPのため維持する。

- `OpenAiEmbeddingProvider`
- `WorkersAiEmbeddingProvider`
- `FakeEmbeddingProvider`
- Provider factoryと未知設定のfail-fast

Providerは入力順、応答件数、有限値、設定次元数を共通検証する。現行機能はvectorの永続保存や検索を行わず、readinessもVectorize bindingを要求しない。将来vector storeを追加する場合は、Embedding Providerとは別のPort／Adapterとして設計し、D1正本とcontent hashを照合する。

## 3. 縮退と機密性

R2 `EXPORTS`が必要な非local環境でbindingが欠ける場合はreadinessを失敗させる。Embedding Providerを利用する設定では、Workers AIなら`AI` binding、OpenAIなら`OPENAI_API_KEY`をfactory生成時に検証する。

access key、session token、CSRF tokenをR2、Embedding入力、logへ渡さない。

