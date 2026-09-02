# DD-03 現行API

## 1. 正式契約

API prefixは`/api/v1`を維持する。routeとrequest schemaの正式契約は、Workerのroute定義と共有Zod schemaから生成する[OpenAPI 3.1](api/openapi.as-built.json)である。旧fieldや削除endpointのaliasは提供しない。

成功responseは原則`{"data": ...}`、失敗responseは`{"error":{"code","message","requestId","details?"}}`とする。認証済みmutationはsession cookie、Origin、CSRFを検証する。

## 2. Endpoint

| method | path | 用途 |
|---|---|---|
| GET | `/health/live` | process liveness |
| GET | `/health/ready` | D1、Provider、必須bindingのreadiness |
| POST | `/users` | 仮登録 |
| POST | `/users/{id}/activate` | access keyによる有効化 |
| POST / DELETE | `/sessions` | login／logout |
| GET | `/me` | 現在のsession |
| POST | `/identity-candidates` | 所有者内のidentity候補解決 |
| GET / POST | `/entries` | Entry一覧／登録 |
| GET / DELETE | `/entries/{id}` | review詳細／archive |
| POST | `/entries/{id}/reanalysis` | 新しい現行revisionで再解析 |
| POST | `/understanding-snapshots/{snapshotId}/review` | 基本像の確認・修正 |
| POST | `/preference-analysis-runs/{runId}/review` | 嗜好assertionの確認 |
| GET | `/profile` | 現行Profileとfreshness |
| GET | `/profile/snapshot-items` | 生成に選択可能な不変snapshot項目 |
| GET | `/profile/graph` | 現行GraphProjection |
| POST | `/generation-requests` | 生成request作成 |
| DELETE | `/generation-requests/{id}` | 完了済み生成履歴の削除 |
| GET | `/generated-characters` | 生成済みキャラクター一覧 |
| GET | `/jobs/{id}` | 非同期job状態 |
| POST | `/jobs/{id}/retry` | job種別に応じた再開 |
| POST | `/account/exports` | 非同期完全export作成 |
| GET | `/account/exports/{exportId}` | export状態 |
| GET | `/account/exports/{exportId}/download` | 認証付きprivate download |
| DELETE | `/account` | username再入力による削除 |

`POST /account/key-rotation`は存在しない。credentialはユーザーごとに現行access key 1件だけを保持し、session generationも公開・保存しない。

## 3. Entry request

Entryは`registrationType`による判別共用体であり、3つの実在variantを維持する。全variantはstrict objectで、未定義fieldを拒否する。

共通field:

- `preferenceContext?`: 好みが特定の時期、場面、状態に限定される場合の文脈
- `referenceMaterial?`: ユーザーが追加する参考情報
- `userCharacterView?`: ユーザー自身の解釈
- `preference`: 好き／苦手な理由、response channel、価値スタンス

variant:

- `existing`: `workTitle`、`characterName`、`mediaType?`、`identityResolution`
- `customized_existing`: existing相当のfieldに加え、`baseCharacterName`、`representationType`、`customizationDescription`
- `original`: `characterName`、`characterBasicInfo`

Entry requestに`schemaVersion`、`knownScope`、`sourceText`はない。既成系の`identityResolution`は`new`または`reuse`を明示する。

## 4. 根拠とProfile

Evidenceの検証状態は次の4状態だけを許可する。

- `verified_quote`
- `source_attributed`
- `model_knowledge`
- `invalid`

外部URLの検証に失敗した出典は現行検証ルールに従い`EXTERNAL_CITATION_NOT_ALLOWED`として扱う。Profile responseは`dimensions`と`valueStances`を返し、常に空だった`patterns`は返さない。

## 5. 生成とExport

生成成果物の公開識別子は`generatedCharacterId`である。内部revision IDはAPI、job result、exportへ出さない。生成時に参照したProfileSnapshotはlive projectionと分離した不変成果物として保持する。

account exportの`schemaVersion`は`3.0`とする。削除済みrevision tableや完了job履歴を互換形式へ再構成しない。

## 6. 契約検査

`npm run contracts:openapi`で生成物との差分を検査する。削除endpoint、field、enumがOpenAPIへ再導入されていないこともtestで固定する。
