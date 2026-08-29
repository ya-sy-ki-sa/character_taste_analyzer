# DD-08 R2・Vectorize詳細設計

## 1. 責務

R2はユーザーが登録した資料原本と、D1へ格納するには大きい再構築可能成果物を保存する。VectorizeはRAG検索と類似検査を補助する。いずれも正本ではなく、metadata、所有者、content hash、再構築状態の正本はD1とする。

初期`free_validation`ではR2/Vectorizeを必須にしない。bindingがない、capacity guardが停止した、またはデータ量が小さい場合は、それぞれD1 inline text・限定的keyword検索へ縮退できる。

## 2. R2 bucket

環境ごとにbucketを分離する。

```text
character-taste-dev
character-taste-preview
character-taste-prod
```

public bucketとして公開しない。全取得は認証済みWorker経由とする。upload/downloadにpresigned URLを発行する場合は5分以内、single object、指定methodに限定する。

## 3. Object key

keyは推測困難なIDだけで構成し、username、作品名、キャラクター名、原ファイル名を含めない。

```text
v1/users/{userId}/sources/{sourceDocumentId}/revisions/{revisionId}/original
v1/users/{userId}/sources/{sourceDocumentId}/revisions/{revisionId}/extracted/{extractorVersion}.json.gz
v1/users/{userId}/graph/{projectionGeneration}/{contentHash}.json.gz
v1/users/{userId}/exports/{exportJobId}/{contentHash}.zip
v1/users/{userId}/generated/{generatedCharacterId}/{revisionId}/artifact/{artifactId}
```

R2 custom metadata:

| key | 値 |
|---|---|
| `owner-user-id` | UUID |
| `content-sha256` | 小文字hex |
| `schema-version` | artifact schema version |
| `source-revision-id` | 該当時のみUUID |
| `created-at` | RFC 3339 |

metadataを認可判断の正本にしない。必ずD1でownerとobject keyの関連を確認してから読み書きする。

## 4. Upload protocol

初期はWorkerが発行する短時間のpresigned URLを使い、browserからR2へ直接uploadする。1 file 10 MiB、1 entry 20 MiBまでとする。対応形式は`text/plain`、`text/markdown`、`application/pdf`、`image/png`、`image/jpeg`、`image/webp`とする。音声・動画は将来拡張とし、画面で選択させない。

1. `POST /sources/upload-requests`へmetadata、size、client計算SHA-256を送り、source/revision IDと5分以内のpresigned PUT URLを得る。
2. browserは指定header付きでR2の最終object keyへ直接PUTする。URLは一object、一methodに限定する。
3. `POST /sources/{sourceId}/revisions`でfinalizeする。
4. WorkerはD1の予定owner/keyとR2 HEADのsize、content type、custom metadata checksumを照合する。宣言との不一致はobjectを採用しない。
5. text/PDF等の抽出後にMIME signatureを再検査し、許可形式でない場合は隔離・削除する。
6. D1へrevision metadataをcommitし、extraction jobを作成する。finalizeされないobjectはorphan sweeper対象にする。

同一`content_hash`でもユーザー間でobjectを共有しない。privacyと削除容易性を優先する。

## 5. Content処理

| 種類 | 抽出結果 |
|---|---|
| plain/Markdown | Unicode正規化後の本文。Markdown構造はlocatorへ保持 |
| PDF | page番号、block順、text。画像だけのPDFはOCR未対応として明示 |
| image | OCRを有効化した場合のみtext化。元画像自体をLLMへ送るかは別consent |

抽出結果は`source_fragments`へ保存する。大きな中間JSONだけR2へ置く。引用位置は抽出本文に対するoffsetであり、PDF byte offsetではない。

## 6. 保持と削除

| object | 保持 |
|---|---|
| source original | ユーザー削除またはaccount削除まで |
| extracted intermediate | current revision＋過去解析から参照されるrevision |
| graph cache | currentと直前世代。その他は7日後削除 |
| export | 作成後24時間で削除 |
| orphan | D1参照がなく作成後24時間経過したものを削除 |

source revisionが解析・snapshotから参照されている間はoriginalを削除しない。UIでは「登録から外す」と「原資料を完全削除」を区別する。

## 7. Vectorize index

初期は用途を混在させず、同じEmbedding model/dimensionごとにindexを分ける。

```text
source-fragments-{environment}-{embeddingVersion}
character-understanding-{environment}-{embeddingVersion}
generated-similarity-{environment}-{embeddingVersion}
```

vector ID:

```text
sf:{sourceFragmentId}:{contentHashPrefix}
ca:{characterAssertionId}:{contentHashPrefix}
gc:{generatedCharacterRevisionId}:{segmentKey}:{contentHashPrefix}
```

metadataはfilterに必要な小さい値だけとする。

```typescript
interface VectorMetadata {
  ownerUserId: string;
  resourceType: "source_fragment" | "character_assertion" | "generated_segment";
  resourceId: string;
  workId?: string;
  characterIdentityId?: string;
  representationId?: string;
  sourceType?: string;
  locale: string;
  contentHash: string;
  embeddingVersion: string;
}
```

ユーザー本文、引用、キャラクター説明をmetadataに入れない。queryは常に`ownerUserId` filterを必須にする。共有catalogを将来導入する場合はprivate indexと別indexにする。

## 8. Embedding対象

- `source_fragment`: 300〜800 token目安。見出しを短く前置する
- `character_assertion`: raw label、value、scopeを一つの文へcanonicalizeする
- `generated_segment`: nameを除き、外見、人格、価値観、関係、役割を別segmentにする
- access key、session、監査IP、削除中データはembeddingしない

embedding前のcanonical textとhashをD1または再生成可能なruleで保持する。同じ`embeddingVersion + contentHash`は再計算しない。

## 9. RAG query

1. request owner、source set version、representation scopeをD1で解決する。
2. queryを1〜3個の検索観点へ分割する。
3. Vectorize queryにownerと許可resource IDのfilterを付ける。
4. top 20を取得し、source priority、scope一致、重複fragmentを再rankする。
5. 最大12 fragment、合計8,000 token相当まで選ぶ。
6. D1から本文とrevisionを再取得し、content hash一致を確認する。
7. LLMへ`fragmentId`付きで渡す。

Vectorizeの結果だけでキャラクター事実を確定しない。source本文の再取得に失敗したmatchは捨てる。

## 10. Outbox同期

| Event | Consumer |
|---|---|
| `SourceFragmentReady` | embedding作成、Vectorize upsert |
| `SourceRevisionDeleted` | fragment vector削除、R2削除 |
| `CharacterUnderstandingConfirmed` | assertion vector upsert |
| `GraphProjectionBuilt` | 大きいprojectionのR2 cache更新 |
| `GeneratedCharacterRevisionCreated` | similarity用vectorの一時upsert |
| `AccountDeletionRequested` | owner配下のobject/vector全削除 |

consumerはevent IDをdedupeし、対象のD1 rowとcontent hashを再確認する。古い世代のeventはno-opでpublishedにする。

## 11. 縮退

| 状態 | 動作 |
|---|---|
| R2 bindingなし | text/Markdown 100 KiBまでD1 inline。file upload非表示 |
| R2 guard停止 | 新規file受付停止。既存readは継続 |
| Vectorize bindingなし | source set内をSQLite keyword/限定全件走査。大規模sourceは解析受付停止 |
| embedding停止 | user指定fragmentとpriority順fragmentだけで解析し、結果を`retrieval_degraded`表示 |
| graph cache停止 | D1のnodes/edgesをpage配布 |

縮退によって根拠が不足する場合、confidenceを上げない。UIとrun metadataにdegradation reasonを表示する。

## 12. 再構築

- R2 graph cache: `graph_projection_nodes/edges`から再生成
- source embedding: `source_fragments`とembedding versionから再生成
- assertion embedding: confirmed assertionとscopeから再生成
- similarity embedding: generated revision JSONから再生成

再構築jobはuser単位、cursor付きbatchとし、同時実行1、1 batch 100 record以下とする。件数とcontent hashを照合してから旧indexを切り替える。
