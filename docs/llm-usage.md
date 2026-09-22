# LLM利用処理とプロンプト一覧

この文書は、現行実装（`archive/`を除く）でLLMを使う処理と、その固定プロンプトの対応をまとめたものです。プロンプト本文の正本は [`worker/llm/prompts`](../worker/llm/prompts) と、外部出典参照規則を持つ [`worker/platform/provenance/registry.ts`](../worker/platform/provenance/registry.ts) です。本文をこの文書へ複製せず、変更時に追従すべきプロンプトの要旨・版・呼出元を記載します。

## 読み方

各LLM呼出は `LlmProvider.generateStructured` による構造化出力です。実行時のメッセージは、原則として次の組合せです。

| 構成要素 | 内容 | 正本 |
| --- | --- | --- |
| 固定指示 | 処理目的、判断規則、禁止事項、出力上の不変条件 | [`worker/llm/prompts`](../worker/llm/prompts) |
| 動的ユーザーメッセージ | 登録情報、確認済み人物理解、候補、Ontology、外部資料、検証結果など | 各呼出元の `messages` 構築処理 |
| 構造契約 | JSON SchemaとZod Schema | [`shared/contracts`](../shared/contracts) と [`contracts/generated/schemas`](../contracts/generated/schemas) |
| 出典規則（対象処理のみ） | 外部出典の台帳、sourceRef、引用の扱い | [`worker/platform/provenance/registry.ts`](../worker/platform/provenance/registry.ts) |

現在のプロンプト版とSHA-256は自動生成manifestの [`contracts/generated/prompts.json`](../contracts/generated/prompts.json) にあります。プロンプトを変更した場合は版を更新し、`npm run assets:generate`（または検査のみの `npm run assets:check`）でmanifestを更新・確認します。

## 本番アプリのLLM処理

### 分析・人物理解

| 処理 / operation | 実行条件・目的 | 固定プロンプト（版） | 主な動的入力 | 出力・呼出元 |
| --- | --- | --- | --- | --- |
| `dark_scope_assessment` | dark版の登録内容がダークキャラ嗜好ラボの対象か判定する。 | `darkScope` / `dark_scope_assessment/v2.3.0` | 登録情報、収集済み情報、許可Pointer | `dark_scope_assessment`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts)、[`scope.ts`](../worker/features/analysis/scope.ts) |
| `character_understanding` | 通常版の既成・オリジナル人物について、7項目の人物像とassertionを抽出する。 | `analysis` / `character_understanding/v2.3.0` | 登録情報、stage、許可Pointer、システム収集資料、Ontology | `character_understanding_candidate`。[`llm-understanding.ts`](../worker/features/analysis/llm-understanding.ts) |
| `customization_delta` | カスタム後の人物について、元キャラクターとの差分を含む人物像を抽出する。 | `analysis` / `character_understanding/v2.3.0` | 上記に加えて、元キャラクターの確認前基本像とカスタム内容 | `character_understanding_candidate`。同じ [`llm-understanding.ts`](../worker/features/analysis/llm-understanding.ts) |
| `dark_baseline_understanding` | カスタム前の元キャラクターを、dark版の比較基準（baseline）として構造化する。通常版の属性や好みは抽出しない。 | `darkBaseline` / `dark_baseline_understanding/v2.3.0` | 元キャラクター、変化前入力、収集済み情報、許可Pointer | `dark_baseline_understanding`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts) |
| `dark_character_understanding` | dark状態を専用Ontologyで分析し、主体性・同意・認識・抵抗・自我・責任・可逆性と変化差分を保持する。 | `darkUnderstanding` / `dark_character_understanding/v2.3.0` | 登録情報、baseline、収集済み情報、許可Pointer、dark Ontology | `dark_character_understanding`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts) |
| `understanding_audit` | 抽出済み人物像を資料・出典と照合し、根拠のない断定を修正する。通常版では情報量の7項目監査と意味監査も行う。 | `understandingInformation` / `understanding-information/v2.1.0` + `understandingSemanticIntegrity` / `semantic-integrity/v1.7.0` | 登録情報、候補、収集済み資料、引用、Ontology、除外・差し替え情報 | `character_understanding_grounded_audit`。[`llm-understanding.ts`](../worker/features/analysis/llm-understanding.ts) |
| `dark_understanding_audit` | dark状態の候補を監査し、根拠のない善化・悲劇化・闇化契機・主体性などを追加せずに改訂する。 | `darkUnderstandingAudit` / `dark_understanding_audit/v2.3.0` | 収集資料、登録情報、候補、照合資料、dark Ontology、レビュー履歴 | `dark_character_understanding`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts) |
| 補完（operationは元処理と同じ） | 根拠検証後の具体項目が2未満の場合に、各stageにつき最大1回補完する。その後、人物理解監査を再実行する。 | `understandingCompletion` / `understanding-information/v2.1.0` をユーザーメッセージへ追加 | 欠落項目、保持済み候補、利用可能な入力Pointer・出典、元の登録情報 | `character_understanding_candidate` または `customization_delta`。[`llm-understanding.ts`](../worker/features/analysis/llm-understanding.ts) |

人物理解の既成キャラクターでは、登録情報とは別にWikipedia・Wikidataから収集した資料が動的入力へ渡されます。検索・出典の収集自体はLLMではなく [`research.ts`](../worker/features/analysis/research.ts) の決定的な外部API処理です。

### 嗜好分析・追加確認

| 処理 / operation | 実行条件・目的 | 固定プロンプト（版） | 主な動的入力 | 出力・呼出元 |
| --- | --- | --- | --- | --- |
| `preference_analysis` | 通常版で、確認済み人物理解とユーザーの好き・苦手・反応から嗜好候補を抽出する。 | `preference` / `preference/v4.1.0` | 確認済み人物理解、嗜好入力、以前の確認記録、除外・差し替え、追加回答、Ontology | `preference_analysis_candidate`。[`preference.ts`](../worker/features/analysis/preference.ts) |
| `preference_audit` | 通常版の嗜好候補を独立監査し、属性粒度、否定の作用域、対象・条件・反応経路、根拠を改訂する。 | `preferenceAudit` / `preference_audit/v3.11.0` + `semanticIntegrity` / `semantic-integrity/v1.7.0` | 初回候補、人物理解、ユーザー入力、レビュー履歴、照合資料、Ontology | `preference_grounded_audit`。[`preference.ts`](../worker/features/analysis/preference.ts) |
| `dark_preference_analysis` | dark版で、ダーク状態・変化差分・支配構造などと結びつく嗜好だけを抽出する。 | `darkPreference` / `dark_preference/v3.11.0` | dark人物理解、dark嗜好入力、変化差分、レビュー履歴、dark反応経路、dark Ontology | `dark_preference_candidate`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts) |
| `dark_preference_audit` | dark版の嗜好候補を監査し、一般的な人物嗜好の混入、主体性・支配・時系列の混同、辞書キーの不整合を修正する。 | `darkPreferenceAudit` / `dark_preference_audit/v3.11.0` | 初回候補、確認済みdark人物理解、ユーザー入力、照合資料、dark Ontology | `dark_preference_candidate`。[`llm-dark.ts`](../worker/features/analysis/llm-dark.ts) |
| `preference_hypotheses` | ユーザーがまだ明言していないが、確認済み人物理解から提案可能な嗜好仮説を最大6件生成する。仮説モードのときだけ実行する。 | `preferenceHypotheses`（通常版）または `darkPreferenceHypotheses`（dark版） / `preference_hypotheses/v2.5.0` | 確認済み人物理解、既存・除外嗜好、過去候補、Ontology、反応経路 | `preference_hypotheses`。[`hypotheses.ts`](../worker/features/analysis/hypotheses.ts) |
| 追加回答による再分析 | 質問への回答やユーザーが選択した仮説を、通常版・dark版の嗜好分析へ追加入力する。独立したoperationではない。 | `preferenceRefinement` / `preference_refinement/v3.11.0` を動的メッセージへ追加 | 追加回答、選択済み仮説、保持済み嗜好、許可Pointer | 通常版またはdark版の嗜好候補・監査。組立ては [`input.ts`](../worker/features/analysis/input.ts) |

### オリジナルキャラクター生成

| 処理 / operation | 実行条件・目的 | 固定プロンプト（版） | 主な動的入力 | 出力・呼出元 |
| --- | --- | --- | --- | --- |
| `character_generation` | 通常版の選択済み抽象嗜好を、既存作品を再現しないオリジナルキャラクターとして1案生成する。1リクエストで最大3案を順番に生成する。 | `generation` / `character_generation/v2.5.0` + `generationVariants` / `generation_variants/v2.5.0` の案別指示 | Generation brief、案番号、変化方向、既生成案の設定 | `generated_character`。[`candidates.ts`](../worker/features/generation/candidates.ts) |
| `dark_character_generation` | dark版の選択済み嗜好から、主体性・支配構造・道徳論理・結末を含むオリジナルキャラクターを生成する。 | `darkGeneration` / `dark_generation/v2.5.0` + `generationVariants` / `generation_variants/v2.5.0` の案別指示 | 同上（dark brief、既生成案を含む） | `dark_generated_character`。[`candidates.ts`](../worker/features/generation/candidates.ts) |
| `generation_validation` | 生成案が各selection、必須・禁止条件、valuePolicy、出力Pointerを実際の人物JSONで満たすか独立検査する。通常版・dark版で共通の検査骨格を使う。 | `generationValidation`（通常版）または `darkGenerationValidation`（dark版） / `generation_validation/v2.5.0` | brief、生成案、決定的なcoverage違反 | `generation_validation_report`。初回生成後と修復後に呼出し。[`candidates.ts`](../worker/features/generation/candidates.ts) |
| `generation_repair` | 検査違反または既存人物との類似度違反がある生成案を、指摘に基づき1回修復する。 | `generation` または `darkGeneration` + `generationRepair` / `generation_repair/v2.5.0` | brief、候補、検査レポート、類似度レポート | 修復済み `generated_character` / `dark_generated_character`。[`candidates.ts`](../worker/features/generation/candidates.ts) |
| `generation_comparison` | 検査に合格した複数案を、設定の一貫性・嗜好適合・案の差・留意点で比較する。最終選択はユーザーに委ねる。 | `generationComparison` / `generation_comparison/v2.5.0` | brief、候補一覧、各検査結果 | `generation_comparison`。[`candidates.ts`](../worker/features/generation/candidates.ts) |

## 共通の自動処理と追加プロンプト

| 機能 | 適用範囲 | プロンプト（版） | 動作 |
| --- | --- | --- | --- |
| 外部出典の引用規則 | dark版の対象範囲判定、人物理解の全呼出し、および通常版・dark版の嗜好抽出／監査 | `citationVerification` / `external-id/v1.1.0` | [`citationAwareProvider`](../worker/features/analysis/citations.ts) が固定指示と出典台帳をメッセージ末尾へ追加する。モデルの引用を台帳・取得資料と照合し、LLM後処理でも検証する。 |
| 人物理解の意味監査 | 通常版の人物理解監査 | `understandingSemanticIntegrity` / `semantic-integrity/v1.7.0` | 人物assertionの主体・対象・極性・根拠範囲を監査する指示として `understandingSystem("audit")` に組み込まれる。 |
| 嗜好の意味監査 | 通常版の嗜好監査 | `semanticIntegrity` / `semantic-integrity/v1.7.0` | ユーザー原文の好悪・否定・反応経路・根拠集合を監査する指示として `preferenceSystem("standard", "audit")` に組み込まれる。 |
| JSON形式の自動修復 | Remote providerの構造化出力がJSONとして読めない、またはSchemaに適合しない場合 | `formatRepair` / `format_repair/v1.1.0` | 直前の出力と検証エラーを追加し、最大1回修復する。元の処理のoperation・ルーティング・Schemaを引き継ぐ。実装は [`remote.ts`](../worker/llm/remote.ts)。 |
| 人物理解監査のassessment修復 | `understanding_audit` のうち `aspectAssessments` だけが不正な場合 | `understandingAssessmentRepair` / `understanding-information/v1.7.0` | 人物像本体を固定したまま、summary/assertionsへの参照番号だけを修復する。実装は [`audit-repair.ts`](../worker/features/analysis/audit-repair.ts)。 |

`semanticIntegrity`、`understandingSemanticIntegrity`、`darkAnalysis` は単独のLLM operationではなく、複合プロンプトを構成する固定指示です。`darkAnalysis` はdark版共通の入力契約・不変条件・主体性の定義を [`dark.ts`](../worker/llm/prompts/dark.ts) の各darkプロンプトへ提供します。

## プロンプト管理単位の全件

上の処理表で参照したものを含め、registryに登録される管理単位は次のとおりです。ここでのキー・版は [`worker/llm/prompts/registry.ts`](../worker/llm/prompts/registry.ts) と生成manifestの対応を示します。

| registry key | promptVersion | 役割 |
| --- | --- | --- |
| `semanticIntegrity` | `semantic-integrity/v1.7.0` | 通常版嗜好の意味監査 |
| `understandingSemanticIntegrity` | `semantic-integrity/v1.7.0` | 人物理解の意味監査 |
| `understandingInformation` | `understanding-information/v2.1.0` | 人物理解監査・情報量判定 |
| `understandingCompletion` | `understanding-information/v2.1.0` | 不足人物像の補完指示 |
| `understandingAssessmentRepair` | `understanding-information/v2.1.0` | assessment参照の限定修復 |
| `preference` / `preferenceAudit` | `preference/v4.1.0` / `preference_audit/v4.1.0` | 通常版の嗜好抽出・監査 |
| `darkPreference` / `darkPreferenceAudit` | `dark_preference/v3.11.0` / `dark_preference_audit/v3.11.0` | dark版の嗜好抽出・監査 |
| `preferenceRefinement` | `preference_refinement/v3.11.0` | 追加回答・選択仮説の再分析指示 |
| `citationVerification` | `external-id/v1.1.0` | 外部出典台帳・引用規則 |
| `preferenceHypotheses` / `darkPreferenceHypotheses` | `preference_hypotheses/v2.5.0` | 通常版・dark版の嗜好仮説 |
| `darkAnalysis` | `dark_analysis/v2.3.0` | dark版共通の分析基盤 |
| `darkScope` | `dark_scope_assessment/v2.3.0` | dark対象範囲判定 |
| `darkBaseline` | `dark_baseline_understanding/v2.3.0` | dark比較基準の人物理解 |
| `darkUnderstanding` / `darkUnderstandingAudit` | `dark_character_understanding/v2.3.0` / `dark_understanding_audit/v2.3.0` | dark人物理解・監査 |
| `analysis` | `character_understanding/v2.3.0` | 通常版人物理解抽出 |
| `generation` / `darkGeneration` | `character_generation/v2.5.0` / `dark_generation/v2.5.0` | 通常版・dark版キャラクター生成 |
| `generationValidation` / `darkGenerationValidation` | `generation_validation/v2.5.0` | 通常版・dark版の生成検査 |
| `generationVariants` | `generation_variants/v2.5.0` | 案番号・変化方向の指示 |
| `generationRepair` | `generation_repair/v2.5.0` | 生成案修復 |
| `generationComparison` | `generation_comparison/v2.5.0` | 生成案比較 |
| `formatRepair` | `format_repair/v1.1.0` | JSON・Schema不適合の修復 |

プロンプトの固定本文には、属性命名の粒度・記号媒体と文脈上の意味の分離、否定の作用域、行為者／対象／所有者の分離、dark版の主体性・状態差分、生成時のハード／ソフト制約などが処理ごとに定義されています。許可される出力フィールドや値の型はプロンプトではなく共有Schemaを正本とします。

## 本番外のLLM利用

| 処理 | 用途 | プロンプト・出力 | 本番処理との関係 |
| --- | --- | --- | --- |
| `scripts/grade-live-personas.mjs` | 固定した実API評価データのclaim・期待要素を構造化採点し、Codexの確認用資料を作る。 | [`gradingInstructions`](../evaluation/live-personas/grading.mjs) をsystem指示として使用し、`gradeSchema`で構造化出力する。2回目の評価パスでは追加指示を付加する。 | アプリの測定対象LLM呼出しとは別の採点補助。結果はアプリDBへ書き戻さない。 |
| `npm run eval:quality -- --provider openai` | 品質評価fixtureを、アプリと同じ分析パイプラインで実行する。 | 独自のsystem promptは持たず、上記の本番分析プロンプトを使用する。 | `fake`が既定であり、実LLMの評価は明示指定時のみ行う。 |

## LLM以外のモデル利用（プロンプトなし）

LLMの処理一覧と混同しないよう、同じ外部AI基盤を使うが自然言語プロンプトを持たない処理も記載します。

| 処理 | 用途 | 入力・出力 | 正本 |
| --- | --- | --- | --- |
| Moderation | 登録・生成フォームの自由記述を事前チェックする。 | テキスト配列 → flagged category | [`worker/features/entries/moderation.ts`](../worker/features/entries/moderation.ts)、[`worker/moderation/providers.ts`](../worker/moderation/providers.ts) |
| Embedding | 既存人物・生成人物の類似度を計算する。 | 文字列チャンク → ベクトル → cosine類似度 | [`worker/features/generation/similarity.ts`](../worker/features/generation/similarity.ts)、[`worker/embedding/providers.ts`](../worker/embedding/providers.ts) |

これらは `MODERATION_MODEL`、`EMBEDDING_MODEL` を使いますが、`LlmOperation` 型やプロンプトregistryには含まれません。

## Jev適用候補の調査（2026-09-18）

この節は改修前の調査記録です。現行の実行経路・責務・設定は [Jev中心の処理](jev-pipeline.md) が正本であり、以下の旧operation名やshadow導入手順は現在のWorker実装を表しません。

### 結論

現行のLLM処理をJevへ全面置換する候補はない。Jevは自由文・コード・説明付きの完全なJSONを生成するモデルではなく、同じ `state` に対する `Choice`・`Score`・`Noul` の型付き判断と確率を返すモデルである。[TypeSafe公式のSystem One説明](https://docs.typesafe.ai/concepts/system-one) でも、生成や理由説明ではなく、ソフトウェアが直接利用する判断を返す位置付けになっている。

このプロジェクトでは、Jevを「候補を生成するLLM」の代わりではなく、既存のLLM出力・根拠・候補を判定する検証器、または複数案を数値化する補助器として使うのが適切である。なおJevは日本語を受け付けるが、公式には英語が最も高精度でCJKは同等ではないとされているため、日本語中心の本番処理では必ず固定ケースで評価する。[TypeSafe公式のModels](https://docs.typesafe.ai/models)

### 優先して調査する候補

| 優先度 | 現行処理 | 判定 | 将来の使い方 |
| --- | --- | --- | --- |
| 高 | `generation_validation` | 部分置換に向く | briefの各選択・必須・禁止条件・policyについて、候補が条件を満たすかを制約ごとの `Noul` で判定する。確率が中間なら `uncertain` として修復または確認へ回し、coverageのexactly-once、JSON Pointer、Schema検査は既存の決定的処理に残す。`outputPointers`や説明文の生成はJevだけでは置き換えられない。 |
| 高 | `understanding_audit`、`preference_audit`、`dark_understanding_audit`、`dark_preference_audit` | 監査部分の補助に向く | 各assertion・preferenceと根拠資料の組を、`supported`／`partial`／`unsupported`／`contradicted`／`unverifiable` の `Choice` で個別判定する。URL・quote・input Pointerの存在確認は既存の決定的検証を維持し、Jevの低確信度は人手確認または従来LLM監査へエスカレーションする。公式Cookbookにも、引用文脈が主張を支持するかをChoiceで再確認する形がある。[Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check) |
| 中 | `generation_comparison` | 併用に向く | 各案の一貫性、嗜好適合、案同士の差を `Score` で評価し、重み付けと並べ替えをコードで行う。現行の具体的な比較文・tradeoff説明は別の生成LLMに残す。複数軸を独立に採点してコードで合成する公式パターンと一致する。[Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) |
| 中 | `dark_scope_assessment` | 前段ゲートに向く | `in_scope`／`borderline`／`out_of_scope` の `Choice`、`agencyOrigin`・`scope` の追加 `Choice` で対象範囲を先に判定する。`rationale`、evidence、recommendedQuestionsの生成は現行LLMに残し、低確信度は継続またはユーザー確認へ送る。 |
| 中〜低 | `scripts/grade-live-personas.mjs` | 本番外の評価補助として候補 | claimの支持状態、期待要素のmatched状態を `Choice` で採点し、確率分布を評価資料に保存する。ただし現在の採点はCodexレビューを含む補助処理なので、Jevの値を正解そのものにせず、凍結goldとの一致率・見逃し・過剰指摘を比較する。 |

### 全面置換しない処理

- `character_understanding`、`customization_delta`、`dark_baseline_understanding`、`dark_character_understanding`：7項目の人物像、assertion、差分、evidenceなどの自由記述を新規に構成するため、Jevの型付き判断だけでは出力を作れない。項目ごとの情報量判定やassertionの根拠支持判定を補助させる余地はある。
- `preference_analysis`、`dark_preference_analysis`：対象・極性・反応経路・条件・引用を入力から発見して候補化する処理で、辞書キー選択だけならChoice化できるが、候補の新規抽出、context、evidence、uncertaintiesの文章化は残る。先にLLMで候補を作り、Jevで対象・極性・反応経路の整合性を検証する段階導入が現実的である。
- `preference_hypotheses`：未明示の嗜好候補を新規に説明付きで提案するため、Jev単独では不適切。別LLMで生成した候補の重複除外・適合度評価には使える。
- `character_generation`、`dark_character_generation`、`generation_repair`：オリジナル人物の文章・設定・関係性・台詞・修復済みJSONを生成する処理であり、Jevの用途ではない。
- `generation_comparison` の比較文、`schema_repair`、JSON形式の自動修復：説明文やJSONを生成する必要があるため、Jevだけでは置き換えられない。
- ModerationとEmbedding：前者は安全判定専用モデル、後者はベクトル類似度用であり、JevのChoice／Score／Noulに置き換える対象ではない。

### 導入時の設計上の注意

1. Jevの質問は、候補生成ではなく「一つの意味的判断」に分解する。例えば生成検査なら、全体の `passed` を直接尋ねず、各constraintを個別の `Noul` として同じstateにまとめ、最終的な合否はコードで合成する。複数質問を一回の呼出しで評価する仕様も公式に案内されている。[State](https://docs.typesafe.ai/concepts/state)、[Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
2. `confidence` はChoice／Scoreの確率分布から算出される不確実性の指標であり、真偽を保証するものではない。Noulはyesの確率を返すため、閾値は実データで校正し、低確信・中間確率を自動採用しない。[Confidence](https://docs.typesafe.ai/confidence)、[Noul](https://docs.typesafe.ai/primitives/noul)
3. このアプリは日本語の細かい否定・条件・反応経路を扱うため、最初から既存LLMを外さず、同じ入力に対するJevの判断を記録するshadow評価から始める。固定fixtureでfalse positive、false negative、保留率、既存監査との一致を比較する。
4. 実装する場合は、現在の `LlmProvider.generateStructured` にJevを無理に同型化せず、`TypeSafeJudge`のような別adapterと結果型を設ける。Jevの公式APIは `state` と typed `questions` を受け、`answers` と確率を返すため、既存の文章生成・Schema修復の契約とは責務が異なる。[HTTP API](https://docs.typesafe.ai/api)
5. 呼出しはWorker側の `AI` bindingから行い、`env.AI.run("typesafe/jev", { state, questions }, { gateway: { id } })` を使う。JevはCloudflareのThird-party modelとしてAI Gatewayに接続されるため、TypeSafe APIキーやCustom Providerをアプリで管理しない。[Cloudflare Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/)、[Worker binding methods](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)

### 改修候補の着手順

1. `generation_validation` のsemantic constraintをJev `Noul`でshadow評価する。
2. 出典付きauditのclaim-evidence組をJev `Choice`でshadow評価し、既存の決定的引用検証と比較する。
3. `generation_comparison`にJev `Score`を追加し、コード側の重み付け結果と現在の比較文を併記する。
4. 日本語fixtureで閾値・保留・エスカレーション条件を校正し、品質とコストが改善した場合だけ一部判定を置き換える。

現時点の判断は、Jevを最初に試す価値が最も高いのは `generation_validation` と根拠監査の判定部分であり、人物理解・嗜好抽出・キャラクター生成そのものではない、というものである。Jevの実API評価はこの調査では実施していない。
