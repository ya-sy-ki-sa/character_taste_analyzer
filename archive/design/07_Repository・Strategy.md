# DD-07 Repository・Strategy詳細設計

## 1. 目的

初期実装は単一D1を利用するが、domain/use caseからCloudflare binding、SQL、外部LLM SDK、Graph実装を分離する。本書のPortを安定契約とし、AdapterまたはStrategyを差し替えられる構造にする。

## 2. 依存方向

```text
UI / HTTP / Workflow trigger
            ↓
      Application UseCase
            ↓
 Domain Model ← Port interface
                    ↑
       D1 / R2 / Workflow / LLM / Embedding Adapter
```

- domainはI/Oを行わない
- use caseはPortにのみ依存する
- Adapterはdomain objectとstorage recordのmappingを担当する
- Cloudflare `env`はcomposition rootで解決し、service constructorへ必要Portだけを渡す

## 3. Repository共通契約

```typescript
type Page<T> = { items: T[]; nextCursor: string | null };

interface UnitOfWork {
  execute<T>(plan: TransactionPlan<T>): Promise<T>;
}

interface TransactionPlan<T> {
  readonly statements: readonly MutationStatement[];
  map(results: readonly MutationResult[]): T;
}
```

D1 Adapterは`statements`全件を一つの`D1Database.batch()`に変換する。ID、revision、hash、append payloadはApplicationで事前に決定し、batch途中の読取結果で後続statementを動的構成しない。読取結果が必要な場合は「事前読取→revision付きbatch」に分け、競合時は全planを再評価する。

規則:

- methodはdomain object/value objectを受け取り、D1 rowを返さない
- private dataを読むmethodは第1引数に`ownerUserId`を持つ
- `save`は期待revisionを必須にし、競合時に`RevisionConflictError`を投げる
- listは上限、stable sort、opaque cursorを必須とする
- insert済みのappend-only recordにupsertを使わない
- idempotent createは一意なbusiness keyを明示する

## 4. Repository interface

### 4.1 User・認証

```typescript
interface UserRepository {
  findPublicActivePage(input: { cursor?: string; limit: number }): Promise<Page<PublicUser>>;
  findById(userId: UUID): Promise<User | null>;
  findByNormalizedName(name: string): Promise<User | null>;
  insertPending(user: User, credential: Credential): Promise<void>;
  activate(userId: UUID, expectedRevision: number, now: IsoDateTime): Promise<User>;
  markDeleting(userId: UUID, expectedRevision: number, now: IsoDateTime): Promise<User>;
}

interface SessionRepository {
  insert(session: Session): Promise<void>;
  findValidByDigest(digest: string, now: IsoDateTime): Promise<Session | null>;
  renew(id: UUID, expectedExpiresAt: IsoDateTime, nextExpiresAt: IsoDateTime): Promise<void>;
  revoke(id: UUID, now: IsoDateTime): Promise<void>;
  revokeAllForUser(userId: UUID, now: IsoDateTime): Promise<number>;
}
```

### 4.2 Entry・Source

```typescript
interface CharacterEntryRepository {
  insertDraft(entry: UserCharacterEntry): Promise<void>;
  findOwned(ownerUserId: UUID, entryId: UUID): Promise<UserCharacterEntry | null>;
  findRevisionOwned(ownerUserId: UUID, entryId: UUID, revisionNumber: number): Promise<EntryRevision | null>;
  listOwned(ownerUserId: UUID, query: EntryListQuery): Promise<Page<EntrySummary>>;
  saveDraft(ownerUserId: UUID, entryId: UUID, draft: EntryDraft,
            expectedAggregateRevision: number): Promise<UserCharacterEntry>;
  appendRevision(ownerUserId: UUID, revision: EntryRevision, expectedAggregateRevision: number): Promise<void>;
  transition(ownerUserId: UUID, entryId: UUID, from: EntryStatus[], to: EntryStatus,
             expectedRevision: number): Promise<UserCharacterEntry>;
}

interface SourceRepository {
  insertDocument(document: SourceDocument, revision: SourceDocumentRevision): Promise<void>;
  findRevisionOwned(ownerUserId: UUID, revisionId: UUID): Promise<SourceDocumentRevision | null>;
  createImmutableSet(ownerUserId: UUID, set: SourceSetVersion): Promise<void>;
  resolveSet(ownerUserId: UUID, setVersionId: UUID): Promise<ResolvedSourceSet>;
}
```

### 4.3 Understanding・Preference・Profile

```typescript
interface CharacterUnderstandingRepository {
  insertRun(run: UnderstandingRun): Promise<void>;
  completeRun(runId: UUID, snapshot: CharacterUnderstandingSnapshot,
              expectedRunRevision: number): Promise<void>;
  findSnapshotOwned(ownerUserId: UUID, snapshotId: UUID): Promise<CharacterUnderstandingSnapshot | null>;
  appendReview(review: UnderstandingReview, replacement?: CharacterUnderstandingSnapshot): Promise<void>;
}

interface PreferenceAnalysisRepository {
  insertRun(run: AnalysisRun): Promise<void>;
  completeRun(runId: UUID, result: PreferenceAnalysisResult,
              expectedRunRevision: number): Promise<void>;
  listCurrentAssertions(ownerUserId: UUID, query: AssertionQuery): Promise<Page<PreferenceAssertion>>;
  appendReview(review: AssertionReview, replacements: PreferenceAssertion[]): Promise<void>;
}

interface PreferenceProfileRepository {
  loadProjection(ownerUserId: UUID): Promise<ProfileProjection | null>;
  replaceProjection(ownerUserId: UUID, next: ProfileProjection,
                    expectedGeneration: number): Promise<void>;
  insertSnapshot(snapshot: ProfileSnapshot): Promise<void>;
  loadSnapshot(ownerUserId: UUID, snapshotId: UUID): Promise<ProfileSnapshot | null>;
}
```

### 4.4 Generation・Job・Outbox

```typescript
interface GenerationRepository {
  insertRequest(request: GenerationRequest): Promise<void>;
  findRequestOwned(ownerUserId: UUID, requestId: UUID): Promise<GenerationRequest | null>;
  attachBrief(requestId: UUID, brief: GenerationBrief): Promise<void>;
  appendRevision(ownerUserId: UUID, character: GeneratedCharacter,
                 revision: GeneratedCharacterRevision): Promise<void>;
  appendFeedback(ownerUserId: UUID, feedback: GenerationFeedback): Promise<void>;
}

interface JobRepository {
  insert(job: Job): Promise<void>;
  findOwned(ownerUserId: UUID, jobId: UUID): Promise<Job | null>;
  findDeletionStatus(jobId: UUID, accessTokenDigest: string): Promise<Job | null>;
  startAttempt(jobId: UUID, lease: JobLease): Promise<JobAttempt>;
  checkpoint(jobId: UUID, checkpoint: JobCheckpoint, expectedRevision: number): Promise<void>;
  complete(jobId: UUID, resultRef: JobResultRef, expectedRevision: number): Promise<void>;
  fail(jobId: UUID, failure: JobFailure, expectedRevision: number): Promise<void>;
}

interface OutboxRepository {
  append(event: OutboxEvent): Promise<void>;
  leaseBatch(input: { now: IsoDateTime; limit: number; leaseOwner: string }): Promise<OutboxEvent[]>;
  markPublished(eventId: UUID, leaseOwner: string, now: IsoDateTime): Promise<void>;
  reschedule(eventId: UUID, leaseOwner: string, nextAttemptAt: IsoDateTime, reason: string): Promise<void>;
}
```

## 5. Strategy/Provider契約

```typescript
interface DeploymentProfileStrategy {
  readonly name: "free_validation" | "cloudflare_paid" | "external_scale";
  admissionFor(capability: Capability, usage: UsageSnapshot): AdmissionDecision;
  limits(): OperationalLimits;
}

interface CharacterCatalogProvider {
  search(input: CatalogSearch): Promise<CatalogCandidate[]>;
  resolve(candidateId: string): Promise<CatalogCharacter | null>;
}

type LlmProviderId = "openai" | "workers_ai" | "replay" | "fake";

interface LlmProvider {
  readonly providerId: LlmProviderId;
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>>;
}

interface EmbeddingProvider {
  embed(documents: EmbeddingDocument[]): Promise<EmbeddingVector[]>;
}

interface ObjectStore {
  put(input: ObjectPut): Promise<ObjectVersion>;
  get(key: string): Promise<ObjectBody | null>;
  delete(key: string): Promise<void>;
}

interface VectorSearchStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(input: VectorQuery): Promise<VectorMatch[]>;
  deleteByOwner(ownerUserId: UUID): Promise<void>;
}

interface BrowserGraphProjector {
  build(ownerUserId: UUID, profileGeneration: number): Promise<GraphProjection>;
}
```

`LlmProvider`はProvider固有のmessage/resultを公開しない。token usage、request ID、model、latency、finish reasonは共通metadataへ写像する。

## 6. Adapter構成

| Port | 初期Adapter | テストAdapter | 将来候補 |
|---|---|---|---|
| Repository/UoW | `D1*Repository`、`D1UnitOfWork` | `InMemory*Repository` | PostgreSQL Adapter |
| ObjectStore | `R2ObjectStore` | memory/fake | S3-compatible |
| LlmProvider | `OpenAiLlmProvider`、`WorkersAiLlmProvider` | `FixtureLlmProvider`、`ReplayLlmProvider` | Provider追加、operation別routing |
| Graph | `GraphologyBrowserGraphEngine` | pure in-memory | server/graph DB |

Adapter選択は環境変数文字列を直接各use caseで分岐せず、composition rootのfactory一箇所で行う。

### 6.1 LLM Adapterと通信経路

| `LLM_PROVIDER` | Adapter | 必要な依存 | 用途 |
|---|---|---|---|
| `openai` | `OpenAiLlmProvider` | `OPENAI_API_KEY`、AI Gateway設定、model ID | 初期必須の外部Provider Adapter |
| `workers_ai` | `WorkersAiLlmProvider` | Cloudflare `AI` binding、AI Gateway ID、model ID | 選択可能Adapter |
| `replay` | `ReplayLlmProvider` | version付きfixture | local/CIの再現試験 |
| `fake` | `FixtureLlmProvider` | 決定論的fixture | unit/E2Eの状態試験 |

`OpenAiLlmProvider`はOpenAI Provider Native endpointを通じてCloudflare AI Gatewayへ接続する。`WorkersAiLlmProvider`も`AI` bindingのgateway optionへ同じGateway IDを渡す。live ProviderからProvider APIへの直接接続は禁止し、AI GatewayはProvider IDを変えずmetadataのtransportとして記録する。

`LlmProviderFactory`は設定とbinding/secretの組合せを検証し、不明なProvider、必要secret欠落、未承認modelでfail fastする。fallbackには`LLM_FALLBACK_MODEL`を使い、主系と異なるProviderだけを許可する。Provider選択はdeployment/実行profile単位とし、`local-manual`は`workers_ai`、`local-test`/CIは`replay`または`fake`を明示的に注入する。ユーザーが画面からAPI keyやProviderを指定する機能は設けない。

`LLM_FALLBACK_PROVIDER`が明示され、両ProviderがDD-15の固定評価とDD-04のdata policyを通過した場合のみ、`LlmProviderRouter`が一時障害に対してfallbackできる。各実呼出しは別の`model_run_metadata`として保存し、途中切替を隠さない。

Embeddingは`EmbeddingProvider` factoryでOpenAI、Workers AI、Fakeを独立選択する。全Adapterは文書IDと入力順を保持し、応答件数、有限値、設定次元数を共通検証する。現行はvector保存bindingを持たないが、Provider境界は将来の保存先追加に対して維持する。

```typescript
interface ApplicationPorts {
  unitOfWork: UnitOfWork;
  objectStore: ObjectStore;
  llm: LlmProvider;
  embedding: EmbeddingProvider;
  clock: Clock;
  ids: IdGenerator;
}
```

## 7. D1 Adapter mapping

- `snake_case` rowと`camelCase` domain objectの変換をmapperに限定する
- JSON textはread時にもschema検証し、破損を`CorruptPersistenceRecordError`として隔離する
- query結果0件は`null`、認可失敗を示す例外にはしない。use caseが404へ変換する
- D1 error codeを直接HTTPへ返さない
- unique違反はconstraint名でdomain errorへ写像する
- integer booleanはmapperでstrictに`0/1`だけ受け入れる
- transaction外で取得したaggregateを保存するときは必ずrevisionを比較する

## 8. Outboxと整合性

RepositoryはD1正本更新と同じUnit of Workでeventをoutboxへ追加する。dispatcherは少なくとも1回配送するため、consumerは`event_id`または`deduplication_key`で冪等にする。

```typescript
type OutboxHandler = (event: OutboxEvent) => Promise<
  | { kind: "published" }
  | { kind: "retry"; retryAt: IsoDateTime; reason: string }
  | { kind: "dead_letter"; reason: string }
>;
```

R2やWorkflowの外部処理成功後にoutboxをpublishedへする。途中失敗時はD1正本をrollbackせず、再配送または派生再構築で回復する。

## 9. 契約test

すべてのRepository Adapterに同一suiteを適用する。

- create/find round tripでdomain値が一致する
- owner AのIDをowner Bが取得できない
- revision競合を必ず検出する
- cursorで重複・欠落がない
- append-only recordを上書きできない
- unique business keyによる冪等性が同じ結果になる
- transaction途中の失敗で全statementがrollbackされる
- outboxが正本更新と同時にだけ作成される
- JSON破損、unknown enum、範囲外scoreを安全に失敗させる

Contract suiteはin-memory、local D1、preview D1に対して実行する。in-memory Adapterの挙動をD1より緩くしない。

## 10. 交換判断

Adapter交換は性能問題だけで行わず、観測値と運用要件からADRで決定する。

- D1容量・write contention・query latencyがDD-14の閾値を継続超過
- 全ユーザー横断集計やserver-side graph traversalが要件化
- SLA、multi-region、point-in-time recovery要件が無料検証構成を超える

交換時もAPI、domain、Repository契約を維持し、dual-read/writeを暗黙導入しない。backfill、検証、read切替、旧系停止を明示したmigration planを作る。
