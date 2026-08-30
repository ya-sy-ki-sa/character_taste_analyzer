# DD-03 API詳細設計

## 1. 基本契約

- base path: `/api/v1`
- protocol: HTTPS only
- media type: `application/json; charset=utf-8`
- schema: [OpenAPI 3.1](api/openapi.yaml)
- success/error envelope、cursor、Idempotency-Keyは[DD-00](00_共通規約.md)に従う
- session、CSRF、Origin、Turnstileは[DD-04](04_認証・セキュリティ.md)に従う
- resource IDの存在と所有権を別errorで示さず、参照権がなければ404とする
- 長時間処理は202と`JobAccepted`を返す
- 削除は物理削除が即時完了する場合204、非同期は202とする

## 2. 共通header

| Header | 方向 | 必須条件 | 用途 |
|---|---|---|---|
| `X-Request-Id` | response | 常時 | trace ID |
| `Idempotency-Key` | request | mutation | UUID |
| `X-CSRF-Token` | request | 認証済mutation | session-derived token |
| `If-Match` | request | revision更新 | quoted revision ETag |
| `ETag` | response | single mutable resource | current revision |
| `Retry-After` | response | 429/503で再試行見込みあり | seconds |

`If-Match`は`"rev-{revision}"`形式とする。body内の`expectedRevision`と二重に持たずheaderを正式値とする。

## 3. Endpoint一覧

### 3.1 認証・ユーザー

| Method | Path | 認証 | CSRF | 容量ガード | 成功 |
|---|---|---:|---:|---:|---:|
| GET | `/users` | No | No | No | 200 |
| POST | `/users` | No | No | registration | 201 |
| POST | `/users/{userId}/activate` | No | No | No | 200 |
| POST | `/sessions` | No | No | No | 200 |
| DELETE | `/sessions` | Optional | session時Yes | No | 204 |
| GET | `/me` | Yes | No | No | 200 |
| POST | `/account/key-rotation` | Yes | Yes | No | 200 |
| POST | `/account/exports` | Yes | Yes | export | 202 |
| DELETE | `/account` | Yes | Yes | 予約容量で常時許可 | 202 |

`GET /account/export`で同期の大きなJSONを返さず、`POST /account/exports`でjobを作成する。上位設計のexport機能はこの非同期APIで実現する。

### 3.2 Catalog・Source・Entry

| Method | Path | 認証 | 容量 | 成功 |
|---|---|---:|---:|---:|
| GET | `/works` | Yes | No | 200 |
| GET | `/characters` | Yes | No | 200 |
| POST | `/sources/upload-requests` | Yes | upload | 201 |
| POST | `/sources/{sourceId}/revisions` | Yes | upload | 201/202 |
| GET | `/sources/{sourceId}` | Yes | No | 200 |
| GET | `/entries` | Yes | No | 200 |
| POST | `/entries/drafts` | Yes | registration | 201 |
| GET | `/entries/{entryId}` | Yes | No | 200 |
| PATCH | `/entries/{entryId}/draft` | Yes | No | 200 |
| POST | `/entries/{entryId}/submit` | Yes | analysis | 200 |
| POST | `/entries/{entryId}/revisions` | Yes | registration | 201 |
| POST | `/entries/{entryId}/reanalysis` | Yes | analysis | 202 |
| DELETE | `/entries/{entryId}` | Yes | profile_rebuild | 202 |

### 3.3 Understanding・Preference

| Method | Path | 認証 | 容量 | 成功 |
|---|---|---:|---:|---:|
| POST | `/entries/{entryId}/character-understanding-runs` | Yes | analysis | 202 |
| GET | `/entries/{entryId}/character-understanding-runs/{runId}` | Yes | No | 200 |
| GET | `/character-understanding-snapshots/{snapshotId}` | Yes | No | 200 |
| POST | `/character-understanding-snapshots/{snapshotId}/review` | Yes | No | 200/202 |
| POST | `/customization-deltas/{deltaId}/review` | Yes | No | 200 |
| POST | `/entries/{entryId}/analysis-runs` | Yes | analysis | 202 |
| GET | `/entries/{entryId}/analysis-runs/{runId}` | Yes | No | 200 |
| POST | `/preference-assertions/{assertionId}/review` | Yes | profile_rebuild | 200/202 |
| POST | `/value-stance-assertions/{assertionId}/review` | Yes | profile_rebuild | 200/202 |

### 3.4 Profile・Graph

| Method | Path | 認証 | 成功 |
|---|---|---:|---:|
| GET | `/profile` | Yes | 200 |
| GET | `/profile/dimensions` | Yes | 200 |
| GET | `/profile/patterns` | Yes | 200 |
| GET | `/profile/evidence` | Yes | 200 |
| GET | `/profile/history` | Yes | 200 |
| POST | `/profile/snapshots` | Yes | 201 |
| GET | `/profile/graph` | Yes | 200 |
| GET | `/profile/graph/nodes/{nodeId}/neighbors` | Yes | 200 |

### 3.5 Generation・Feedback

| Method | Path | 認証 | 容量 | 成功 |
|---|---|---:|---:|---:|
| POST | `/generation-requests` | Yes | generation | 201 |
| GET | `/generation-requests/{requestId}` | Yes | No | 200 |
| PATCH | `/generation-requests/{requestId}` | Yes | No | 200 |
| POST | `/generation-requests/{requestId}/compile-brief` | Yes | generation | 200 |
| POST | `/generation-requests/{requestId}/generate` | Yes | generation | 202 |
| GET | `/generated-characters/{characterId}` | Yes | No | 200 |
| POST | `/generated-characters/{characterId}/revisions` | Yes | generation | 202 |
| POST | `/generated-characters/{characterId}/feedback` | Yes | profile_rebuildはopt-in時 | 201/202 |
| DELETE | `/generated-characters/{characterId}/feedback/{feedbackId}` | Yes | profile_rebuild | 202 |

### 3.6 Job・Capacity

| Method | Path | 認証 | 成功 |
|---|---|---:|---:|
| GET | `/jobs/{jobId}` | sessionまたは削除status token | 200 |
| POST | `/jobs/{jobId}/retry` | Yes | 202 |
| GET | `/capacity` | Yes | 200 |

`GET /capacity`は課金メトリクスの生値やaccount全体の機密情報を返さず、ユーザーに関係する`normal / warning / conservation / restricted / unavailable`、停止機能、再開見込みだけを返す。

## 4. 認証API詳細

### 4.1 GET `/users`

query:

```text
search?: string <= 32
cursor?: opaque
limit?: 1..100, default 50
```

response item:

```typescript
interface PublicUser {
  id: UUID;
  username: string;
}
```

sortは`username_normalized ASC, id ASC`。active userだけを返す。

### 4.2 POST `/users`

```typescript
interface CreateUserRequest {
  username: string;
  consentVersion: string;
  turnstileToken: string;
}

interface CreateUserResponse {
  user: { id: UUID; username: string; status: "pending" };
  accessKey: UUID;
  expiresAt: IsoDateTime;
}
```

### 4.3 POST `/users/{userId}/activate`

```typescript
interface ActivateUserRequest { accessKey: UUID }
interface ActivateUserResponse { user: { id: UUID; username: string; status: "active" } }
```

### 4.4 POST `/sessions`

```typescript
interface CreateSessionRequest {
  userId: UUID;
  accessKey: UUID;
  turnstileToken: string;
}

interface SessionResponse {
  user: { id: UUID; username: string };
  csrfToken: string;
  expiresAt: IsoDateTime;
}
```

### 4.5 GET `/me`

`SessionResponse`とcapacity summaryを返す。session renewalが起きた場合は新expiresAtとcookieを返す。

### 4.6 POST `/account/key-rotation`

```typescript
interface RotateKeyRequest { currentAccessKey: UUID }
interface RotateKeyResponse { accessKey: UUID; sessionsRevoked: true }
```

responseと同時にcurrent cookieを削除する。

### 4.7 Export・account deletion

`POST /account/exports`は選択categoryを固定してExportWorkflowを開始し202を返す。download URLはJob成功後に取得し、24時間で失効する。

`DELETE /account`は`usernameConfirmation`を照合後、同じtransactionでuserを`deleting`へし全sessionを失効する。202の`JobAccepted.data.statusToken`に削除状態確認用の256-bit pseudorandom tokenを返し、D1にはdigestだけを保存する。冪等再送時はDD-04の式で同じtokenを再導出する。以後はsessionでなく`X-Deletion-Status-Token`で該当削除Jobだけを参照できる。tokenの有効期限は7日、完了後24時間とし、retryや他Jobへの利用は不可とする。

## 5. Source upload protocol

### 5.1 upload request

```typescript
interface SourceUploadRequest {
  title: string;
  fileName: string;
  mimeType: "text/plain" | "text/markdown" | "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;       // 1..10MiB in free_validation
  sha256Hex: string;
  sourceType: "official" | "primary" | "secondary" | "transformative" | "user_text";
  rightsBasis: string;
  visibility: "private";
}

interface SourceUploadTicket {
  sourceId: UUID;
  sourceRevisionId: UUID;
  objectKey: string;
  uploadUrl: string;
  method: "PUT";
  requiredHeaders: Record<string, string>;
  expiresAt: IsoDateTime;
}
```

- upload URLは5分で失効する
- object keyとcontent length、MIME、checksumをsignatureに含める
- R2 CORSは`APP_ORIGIN`のPUTと必要headerだけを許可する

### 5.2 finalize revision

```typescript
interface FinalizeSourceRevisionRequest {
  sourceRevisionId: UUID;
  objectKey: string;
  sha256Hex: string;
  byteSize: number;
  citation: {
    author?: string;
    url?: string;
    workTitle?: string;
    medium?: string;
    rightsHolder?: string;
    rightsBasis: string;
  };
}
```

serverはR2 HEADでkey、size、metadata checksumを再検証する。成功後に抽出jobが必要なら202、plain textで即時完了なら201とする。

## 6. Entry API詳細

### 6.1 draft作成

```typescript
interface CreateEntryDraftRequest {
  registrationType: "existing" | "customized_existing" | "original";
}
```

201で空のEntry aggregateとrevision 0のETagを返す。

### 6.2 draft更新

```typescript
interface UpdateEntryDraftRequest {
  schemaVersion: "2";
  work?: { id?: UUID; title?: string; mediaType?: string };
  character: { id?: UUID; name: string };
  /** registrationType=customized_existingのとき必須。元キャラクターの特定・基本像解析に使う */
  baseCharacterName?: string;
  representation: {
    baseRepresentationId?: UUID;
    type: string;
    canonicality: string;
    scopeType: string;
    scopeDescription: string;
    transformationSummary?: string;
  };
  preferenceContext?: string;
  /** registrationType=originalのとき必須 */
  characterBasicInfo?: string;
  referenceMaterial?: string;
  familiarity?: "new" | "familiar" | "long_term";
  userCharacterView?: string;
  sourceDocumentIds: UUID[];
  preferenceInput?: Record<string, unknown>;
}
```

`customized_existing`の`character.name`はカスタム後の表示名である。同一人物候補の照合、外部調査、「既成キャラクターの基本像」には`baseCharacterName`を使う。

OpenAPIで共通構造を検証した後、serverがEntry aggregateの`registrationType`に対応するtype-specific Zod schemaを選んで検証する。bodyのtype指定で保存済みregistrationTypeを切り替えることはできない。上記は共通の説明用表現である。

`preferenceContext`は、キャラクター全体ではなく特定の時期・場面・人格・状態に限って好きな場合の任意補足である。未指定時はキャラクター全体を対象とし、ユーザーへ解析対象範囲の指定を要求しない。

`characterBasicInfo`は`registrationType=original`の場合だけ必須とする。性格、価値観、目的、行動、関係性、物語上の役割など、そのキャラクターの基本像を構成できる情報をユーザーが入力する。既成キャラクターにおける「作品名・キャラクター名・媒体からシステムが収集した公開情報」と同じ入力階層に置き、任意参考情報やユーザー自身の解釈とは混同しない。

`referenceMaterial`は、ユーザーが解析へ加えたい参考情報を任意で入力する欄である。既成・既成（カスタム）の一般的な基本情報はシステム側の公開情報検索とLLMのモデル知識から収集し、この項目を必須資料として扱わない。旧`sourceText`は既存ローカルデータの読込みだけに使用する。

PATCHはUserCharacterEntryのmutable draft payloadを更新し、append-only EntryRevisionはまだ作らない。`If-Match`はEntry aggregateのrevisionを比較する。

### 6.3 submit

- draftをvalidationし、最初または次番号のappend-only EntryRevisionを作る
- SourceSetVersionを固定する
- Entry statusを`submitted`にする
- responseにentryRevisionId、sourceSetVersionId、next actionを返す
- LLM jobは自動開始せず、次の`character-understanding-runs`で明示開始する

### 6.4 再分析

`POST /entries/{entryId}/reanalysis`は、現在の嗜好入力を任意に修正してappend-onlyな次の`EntryRevision`を作り、キャラクター理解から再分析する。`active`、`understanding_review`、`analysis_review`、`failed`から開始できる。解析中の二重起動と`archived`からの開始は拒否する。

- 過去のRevision、理解Snapshot、嗜好解析Run、ユーザー確認は履歴として保持する
- 新しいRevisionを`activeRevisionNumber`へ設定し、旧Revisionの確認待ちJobは`superseded`にする
- 再分析開始後、新しい嗜好解析を確認するまでは当該Entryを累積プロフィールへ混ぜない
- 同じキャラクター表現とSourceSetVersionを参照するが、理解Snapshotと嗜好解析Runは新しいgenerationを作る

### 6.5 delete

- draftは関連派生データがなければ論理削除後に204を返してよい
- activeはarchive、Profile再計算、Graph再構築をjob化し202とする
- evidenceとcorrectionはユーザーaccount削除まで監査・再計算用に残す

## 7. Run・Review API

### 7.1 Run開始

```typescript
interface StartRunRequest {
  entryRevisionId: UUID;
  force: boolean;
}

interface JobAccepted {
  jobId: UUID;
  status: "queued";
  targetType: string;
  targetId: UUID;
}
```

- 同じentry revision、source set、prompt/schema/model/ontology versionの成功runがあり`force=false`なら再利用候補を返す
- running runがある場合は既存jobを返す
- `force=true`はユーザーdaily quotaとcapacityを新たに消費する

### 7.2 Review

```typescript
interface ReviewRequest {
  decision: "confirm" | "correct" | "reject" | "conditional";
  reasonText?: string;
  condition?: ContextCondition;
  correction?: Record<string, unknown>;
}
```

- correctは対象typeに応じたcorrection schemaで検証する
- conditionalはcondition必須
- review後に必須確認が全て完了した場合だけ、後続jobをenqueueし202とする。後続なしは200
- as-builtの`POST /api/v1/preference-analysis-runs/{runId}/review`は、`confirm_all`に加えて`reject_selected`と単一のPreferenceAssertionまたはValueStanceAssertion IDを受け付ける。owner、active revision、Entryの`analysis_review`状態、Runとの所属を検証して対象を`rejected`にし、以後の確認画面とProfile集計から除外する。再送時にすでに`rejected`なら同じ結果を返す

## 8. Profile API

### 8.1 GET `/profile`

```typescript
interface ProfileSummaryResponse {
  projectionId: UUID | null;
  generation: number;
  updatedAt: IsoDateTime | null;
  topPositive: ProfileDimensionSummary[];
  topNegative: ProfileDimensionSummary[];
  responseChannels: ProfileDimensionSummary[];
  valueStances: ValueStanceSummary[];
  dataQuality: ProfileDataQuality;
}
```

profile未作成は404ではなく、`projectionId=null`と空配列を200で返す。

### 8.2 dimensions・patterns・evidence・history

- cursor pagination
- default 50、max 200
- filterはDD-02の共通filterを使う
- evidenceの引用原文はこのendpointでのみ遅延取得する
- sensitive response channelはuser settingに応じて非表示または明示操作後に表示する

### 8.3 snapshot作成

```typescript
interface CreateProfileSnapshotRequest {
  projectionId?: UUID; // omitted = current
  purpose: "generation" | "comparison" | "export";
}
```

current projectionのevidence set hashを再計算し、異なる場合は409 `PROFILE_STALE`とする。

## 9. Graph API

### 9.1 GET `/profile/graph`

query:

```text
profileSnapshotId?: UUID, omitted=current projection based snapshot
projectionVersion?: string
detail?: summary|standard|expanded, default=standard
nodeTypes?: comma-separated allowlist
cursor?: opaque
limit?: 1..1000, default=500
```

- JSON Schemaは[GraphProjection](schemas/graph-projection.schema.json)
- first pageは重み上位nodeとそのedgeを返す
- edgeの両端nodeは同じpage、または同じprojectionの前pageで配布済みでなければならない
- 原文、内部owner ID、security metadataを含めない

### 9.2 neighbors

query:

```text
profileSnapshotId: UUID
depth: 1..2, default=1
edgeTypes?: allowlist
limit: 1..500, default=100
cursor?: opaque
```

serverはGraphProjectionの確定済edgeだけを返し、shortest pathやcommunity detectionはbrowserで行う。

## 10. Generation API

### 10.1 request作成・更新

```typescript
interface CreateGenerationRequest {
  profileSnapshotId: UUID;
  mode: "faithful" | "balanced" | "exploratory";
  purpose?: string;
  world?: string;
  genre?: string;
  role?: string;
}
```

PATCHはselection、価値条件、content range、free instructionを更新する。`draft`と`brief_ready`のみ更新可能とする。

### 10.2 compile brief

- [GenerationBrief Schema](schemas/generation-brief.schema.json)で検証する
- ProfileSnapshot itemの所有者とselectionを再検証する
- prohibitとrequiredが同じattribute/contextで衝突する場合422 `GENERATION_CONSTRAINT_CONFLICT`
- brief revisionをappend-onlyで保存し、human-readable summaryを返す

### 10.3 generate・partial revision

- generateは最新確定brief revisionを固定する
- partial revision requestは`baseRevisionId`, `scope`, `targetPointers[]`, `instruction`, `preservePointers[]`を必須とする
- scopeは定義済sectionだけ、pointerはGeneratedCharacter Schema内に実在するpathだけを許可する
- user instructionでもserverの必須security policyとprohibited constraintを解除しない

### 10.4 feedback

```typescript
interface CreateFeedbackRequest {
  revisionId: UUID;
  overallRating?: 1 | 2 | 3 | 4 | 5;
  sectionRatings: Array<{
    section: string;
    rating: -2 | -1 | 0 | 1 | 2;
    attributeDefinitionId?: UUID;
    comment?: string;
    proposeAsPreferenceEvidence: boolean;
  }>;
}
```

`proposeAsPreferenceEvidence=true`の項目だけがreview待ちPreferenceAssertion候補を作る。自動確定しない。

## 11. Job API

```typescript
interface JobResponse {
  id: UUID;
  jobType: string;
  status: JobStatus;
  targetType: string;
  targetId: UUID;
  progress: { current: number; total: number; step: string | null };
  retryable: boolean;
  error?: { code: string; message: string };
  result?: Record<string, unknown>;
  nextAttemptAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

- 通常jobはownerだけが参照・retryできる
- account deletion jobだけはsession失効後、該当Jobに紐づく削除status tokenで参照できる
- `failed`かつ`retryable=true`のみretry可能
- retryはnew attemptを作成し、job IDは維持する
- `waiting_for_user`はretryではなく対応review APIで再開する

## 12. Error catalog

| HTTP | code | 用途 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | request schema/field |
| 400 | `INVALID_CURSOR` | cursor署名・filter不一致 |
| 400 | `TURNSTILE_FAILED` | bot検証失敗 |
| 401 | `AUTH_REQUIRED` | sessionなし |
| 401 | `INVALID_CREDENTIALS` | user/keyを区別しない |
| 403 | `ORIGIN_REQUIRED` | unsafe requestのOriginなし |
| 403 | `ORIGIN_DENIED` | Origin不一致 |
| 403 | `CSRF_INVALID` | CSRFなし・不一致 |
| 404 | `RESOURCE_NOT_FOUND` | 不在または非owner |
| 409 | `USERNAME_TAKEN` | username重複 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | keyとbody hash衝突 |
| 409 | `REVISION_CONFLICT` | ETag不一致 |
| 409 | `INVALID_STATE_TRANSITION` | 現状態で不可 |
| 409 | `PROFILE_STALE` | evidence setが更新済み |
| 410 | `REGISTRATION_EXPIRED` | pending期限切れ |
| 413 | `PAYLOAD_TOO_LARGE` | body/file上限 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME不可 |
| 422 | `REVIEW_INCOMPLETE` | 必須review残り |
| 422 | `LLM_OUTPUT_REJECTED` | schema/grounding修復失敗 |
| 422 | `PROVIDER_POLICY_REJECTED` | Providerが生成を拒否。ユーザーへの道徳評価には使わない |
| 422 | `GENERATION_CONSTRAINT_CONFLICT` | required/prohibit衝突 |
| 429 | `RATE_LIMITED` | 短時間rate limit |
| 429 | `USER_QUOTA_EXCEEDED` | user daily quota |
| 429 | `CAPACITY_DEGRADED` | free-tier guardにより高コスト操作を受付停止 |
| 502 | `EXTERNAL_PROVIDER_INVALID_RESPONSE` | Provider不正応答 |
| 503 | `EXTERNAL_PROVIDER_UNAVAILABLE` | Provider一時障害 |
| 503 | `CAPACITY_UNAVAILABLE` | 予約対象を含め現在処理不能 |
| 503 | `DERIVED_STORE_UNAVAILABLE` | Vectorize等。fallback不能時 |
| 500 | `INTERNAL_ERROR` | 非公開の内部error |

## 13. API変更・廃止

- additive fieldはclientが無視できることを契約testする
- required field追加、enum削除、意味変更は`/api/v2`または段階的migrationを必要とする
- responseのdeprecated fieldは少なくとも1 release cycle残す
- OpenAPI diffをCIで検査し、breaking changeを要承認にする
