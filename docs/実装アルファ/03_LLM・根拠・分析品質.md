# LLM・根拠・分析品質

## 1. 「根拠付き」の実装は provenance を再設計する

現在の UI は「主張から入力の原文へ追跡」と説明していますが、保存される evidence は実際の根拠位置を十分に表していません。

### Character Analysis

- `characterBasicInfo` と `referenceMaterial` を結合して1つの source document/fragment にしています（`worker/services/entries.ts:61-69`, `:162-207`）。どちらの入力が根拠か区別できません。
- `userCharacterView` は prompt に渡されますが source fragment として保存されません。
- Wikipedia 調査結果は prompt の `sourceAssessment` に含まれますが、同じ source document/fragment モデルへ保存されません。
- OpenAI hosted search の source annotation は、本文抽出時に捨てられます（`worker/llm/providers.ts` の response text 抽出）。
- model knowledge 以外の assertion は、実際の出典に関係なく Entry の最初の fragment へ結び付けられます（`worker/services/analysis.ts:635-650`）。

たとえば Wikipedia 由来の主張や利用者のキャラクター観が、reference material の fragment を根拠として表示され得ます。これは表示上の不備だけでなく、分析訂正、監査、再分析時の差分確認にも影響します。

### Preference Analysis

- preference assertion の evidence origin は常に `user_input` です。
- 入力箇所は肯定・否定・推論を問わず `/preference/likedReasons` に固定されています（`worker/services/analysis.ts:877-882`）。
- value stance も、実際には liked reasons 等から抽出されても `/preference/valueStanceNote` に固定されています（同 `:906-910`）。
- quote の開始/終了 offset や検証 hash は保存されません。

### 推奨する最小 provenance 契約

LLM の各 assertion 出力に、少なくとも次を必須化します。

```json
{
  "text": "...",
  "origin": "user_input | user_reference | system_research | model_knowledge",
  "sourceId": "stable-source-id-or-null",
  "inputPointer": "/preference/dislikedReasons/0",
  "quote": "根拠となる短い原文",
  "startOffset": 10,
  "endOffset": 24,
  "inference": "direct | paraphrase | inferred",
  "confidence": 0.82
}
```

保存前にサーバー側で次を検証します。

1. `sourceId` がその run の入力集合に存在する。
2. pointer が snapshot 上に存在する。
3. direct quote は正規化規則を適用しても原文の substring である。
4. offset が quote と一致する。
5. model knowledge には存在しない source を付けない。
6. system research には URL、取得時刻、title、該当 excerpt を持たせる。

検証できない場合は assertion を捨てるのではなく `unverified` として隔離し、UI の「原文へ移動」対象から外すと原因を観測できます。

## 2. 外部調査の出典同一性を上げる

現行の system research は Wikipedia 検索上位候補を使います（`worker/services/character-research.ts`）。同名人物、同名作品、曖昧さ回避ページ、版違いが混ざる可能性があります。LLM に不確実性を伝えていても、取得段階の entity matching が弱いままでは根拠品質が安定しません。

改善順:

1. `character name + work title + creator/media` で候補を検索する。
2. page title、intro、カテゴリ等で作品・キャラクターの一致度を決定的に採点する。
3. 一致しない候補は prompt へ入れない。
4. 同じ URL・同じ内容を deduplicate する。
5. source type、URL、取得時刻、license/利用条件、excerpt を保存する。
6. 利用者の `known_scope` より先のネタバレを調査・提示しない方針を決める。
7. hosted web search を使う場合も annotation/citation を response adapter から保存層まで通す。

調査結果とモデルの事前知識は分けて扱い、UI も「利用者入力」「外部資料」「モデル知識」を同じ確からしさとして表示しない方がよいです。

## 3. 同一作品・同一キャラクターの偏り補正が登録横断で働かない

Entry 作成時は毎回新しい `works` と `character_identities` を作ります（`worker/services/entries.ts:44-52`, `:71-104`）。プロファイル集計は work ID / identity ID で多重登録の割引を行うため、同じ名称を繰り返し登録しても別作品・別キャラクターとして数えられます。

これは README の「同じ作品・キャラクターへの偏りを補正する」という価値に直接影響します。

### 推奨データモデル

- owner scope の canonical work / identity と、Entry 固有 revision を分離する。
- title/name の正規化候補を提示するが、自動 merge はせず利用者が確認できるようにする。
- リメイク、媒体差、同名別人、別人格、カスタム派生を分離する override を持つ。
- 後から merge/split しても assertion の lineage が残る。
- 集計では canonical cluster と Entry 数の両方を使い、割引根拠を説明可能にする。

最小の回帰テストは「同じ作品・identity の Entry を2件追加したとき、異なる2作品より寄与が割り引かれる」です。

## 4. assertion 固有の文脈が profile で失われる

LLM の `preferenceAssertion.contextText` は `preference_assertions.context_json` に保存されます（`worker/services/analysis.ts:852-875`）。しかし profile の weighting は Entry の `known_scope` だけから condition を作り、assertion の context を使いません（`worker/services/profile.ts:147-171`）。

その結果、次の違いが同じ条件に平坦化されます。

- 普段は嫌いだが、その場面だけ好き。
- ヴィランには好きだが、主人公には嫌い。
- 恋愛関係では嫌いだが、師弟関係では好き。
- 結末まで改心しない場合に限って好き。

`context_json` を自由文のまま足し込むのではなく、対象、関係、物語局面、scope、例外条件、confidence へ正規化し、profile condition と generation constraint まで伝播させるべきです。利用者が後から condition を編集・統合できる設計も有効です。

## 5. 現実価値観と創作嗜好の分離

この領域のデータ構造と prompt 方針は良好です。今回、`.dev.vars` の OpenAI 設定を使い、次の合成的な意味確認を実施しました。

- モデル: `gpt-5.6-luna`
- 入力趣旨: 「残酷で改心しないヴィランが創作では好きだが、現実の加害は支持しない」
- 期待: fiction preference に no-redemption / villain traits を残し、real-world support を false とする
- 結果: 期待どおり分離し、好みの意味も保持した

これは1例のスポット検査にすぎません。否定、皮肉、引用、複数言語、自己矛盾、センシティブ題材、入力不足などを固定 fixture にし、モデル変更時に回帰比較する必要があります。詳細設計が想定する fixture 群を実体化し、次を評価してください。

- JSON schema valid rate
- 根拠 pointer/quote valid rate
- value-preference separation precision/recall
- no-redemption 等の protected meaning retention
- 不確実性の過剰断定率
- provider/fallback 間の差
- 同一入力の複数回実行における profile 変動幅

## 6. LLM adapter と model run の改善

### repair の Idempotency-Key

JSON parse/schema validation に失敗すると、adapter は repair prompt を作りますが、元の `request.idempotencyKey` を再利用します（`worker/llm/providers.ts:98-119`）。OpenAI へはそのまま `Idempotency-Key` header として送られます（同 `:197-205`）。body が違うのに同じ key なので、元の不正応答が再利用されるか、key/body mismatch になる可能性があります。

`root-id:attempt-0`、`root-id:repair-1` のように attempt key を派生させ、root correlation は別フィールドで保持してください。

### provider capability

request 型と analysis/generation は temperature を指定しますが、OpenAI Responses 経路では送っていません（`worker/llm/providers.ts:206-227`）。Workers AI 経路とは設定の意味が異なります。モデルによって使えないパラメータを無理に統一せず、adapter capability を明示し、実際に効いた sampling/reasoning 設定を model run に保存する方が安全です。

### fallback と prompt provenance

router は fallback を返せますが、永続 model run では最終 provider/model が中心で、一次 provider の失敗理由や fallback chain を監査できません。`prompt_version` も定数で、実際の prompt 内容を変えても version 更新を強制する仕組みがありません。

保存推奨項目:

- prompt template ID、semantic version、content hash
- input schema version、output schema version
- provider/model、provider request ID、attempt
- reasoning/sampling/tool 設定の実効値
- primary error class、fallback reason、fallback chain
- latency、input/output token、修復回数
- source set hash と source IDs

`LLM_FALLBACK_PROVIDER` が primary と同じ、model が未設定、API key がない等の矛盾は router 生成時に fail fast し、health/readiness に反映させるべきです。

## 7. 生成結果の制約検証を強化する

現行の `briefCoverage()` は選択項目の mapping/treatment/status の存在を検査しますが、各項目が exactly once か、`outputJsonPointers` が実在するか、実際の生成物が禁止条件を破っていないかは検証しません（`worker/services/generation.ts:473-483`）。保存時は各項目の最初の pointer だけを使います（同 `:504-518`）。

次の二層検査が適切です。

### 決定的検査

- selected item ごとに coverage がちょうど1件。
- selected 外の ID が coverage にない。
- pointer が出力 JSON に存在する。
- pointer が空文字や別オブジェクトを指さない。
- prohibited item は satisfied ではなく、明示的な回避説明を持つ。
- conflict resolution が参照する ID は request 集合内にある。

### 意味検査

- 出力本文が mapping/treatment を実現している。
- prohibited trait、救済、関係性、トーンを侵していない。
- protected meaning を弱めて「安全な別物」にしていない。
- confidence と検査理由を保存し、閾値未満は利用者へ警告する。

意味検査に別 LLM を使う場合も、それ自体を絶対判定にせず、fixture 評価と利用者 feedback で校正します。

## 8. Embedding の確認と現在の位置付け

`text-embedding-3-small` は `.dev.vars` を使ったスポット確認で、各 vector が1536次元かつ有限値でした。近い日本語文の cosine similarity は、無関係な文より高い結果でした。

ただし現在のサービス処理で embedding provider は実質的に health/config 確認に留まり、profile 集計や生成の similarity には接続されていません。未使用の依存を readiness 必須にする必要性は薄く、次のどちらかを明示すべきです。

- アルファでは任意機能として health から分離する。
- similarity を実装し、個人内 index、削除整合、dimension migration、評価指標まで完成させる。

staging の `EMBEDDING_DIMENSIONS` も明示し、provider model、期待 dimension、Vectorize index dimension の一致を deploy 前に検査してください。
