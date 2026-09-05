# キャラ嗜好ラボ 詳細設計書

- 文書種別: 詳細設計
- 作成日: 2026-08-29
- 基準: 現行Worker、共有Zod schema、生成OpenAPI、baseline DDL
- 互換方針: 旧Entry、旧根拠、key rotation等の互換API／列／tableは保持しない
- 初期運用: Cloudflare無料枠の`free_validation`
- LLM: OpenAI Adapterを初期必須、Workers AI Adapterを選択可能とし、環境設定で切り替える。ローカルの手動画面確認はWorkers AIを既定とし、自動テストはFake/Replayを使う。外部LLMの費用とquotaはCloudflare無料枠管理と分離する

## 1. 文書の目的

本文書群は現行機能を、実装、コードレビュー、テスト、運用設計に直接渡せる契約へ展開する。実装との差異が生じた場合は、生成OpenAPI、共有Zod schema、baseline DDLを正本として同じ変更で文書を更新する。

詳細設計で次を確定する。

- レイヤー、モジュール、依存方向
- 画面項目、UI状態、validation、アクセシビリティ
- HTTP API、request/response、error、認可、冪等性
- 認証・セッションの暗号入力と失効規則
- ドメイン型、不変条件、状態遷移
- D1の全DDL、index、削除規則、migration規則
- Repository、Unit of Work、Strategy、Providerの契約
- R2 export objectと派生同期
- Workflow step、Queue event、retry、再開、削除
- LLM入出力、RAG、根拠検証、修復、固定評価
- 属性辞書、嗜好集計式、価値スタンス
- GraphProjection、Web Worker protocol、Graphology、Sigma.js
- GenerationBrief、生成、類似検査、Revision、Feedback
- Cloudflare無料枠の容量ガード、縮退、監視、将来移行
- テストレベル、fixture、LLM評価、公開ゲート

## 2. 分冊一覧

| ID | 文書 | 主な実装契約 |
|---|---|---|
| DD-00 | [共通規約](00_共通規約.md) | 型、命名、ID、時刻、JSON、冪等性、error |
| DD-01 | [アーキテクチャ](01_アーキテクチャ.md) | 配置、レイヤー、モジュール、依存方向 |
| DD-02 | [画面・フロントエンド](02_画面・フロントエンド.md) | route、画面項目、UI状態、validation |
| DD-03 | [API](03_API.md) | endpoint、schema、error、認可、cursor |
| DD-04 | [認証・セキュリティ](04_認証・セキュリティ.md) | access key、session、CSRF、Turnstile、脅威対策 |
| DD-05 | [ドメインモデル](05_ドメインモデル.md) | aggregate、entity、value object、不変条件 |
| DD-06 | [D1データベース](06_D1データベース.md) | physical schema、index、query、migration |
| DD-07 | [Repository・Strategy](07_Repository・Strategy.md) | Port、UnitOfWork、Adapter、契約test |
| DD-08 | [R2・Embedding](08_R2・Embedding.md) | export object、Embedding Provider境界 |
| DD-09 | [Workflow・Queue・Job](09_Workflow・Queue・Job.md) | step、event、retry、DLQ、再開 |
| DD-10 | [LLM・RAG](10_LLM・RAG.md) | Provider、prompt、schema、grounding、eval |
| DD-11 | [属性辞書・嗜好集計](11_属性辞書・嗜好集計.md) | ontology、score、confidence、pattern |
| DD-12 | [嗜好グラフ](12_嗜好グラフ.md) | projection、worker protocol、探索、描画 |
| DD-13 | [オリジナルキャラクター生成](13_オリジナルキャラクター生成.md) | brief、生成、禁止条件、類似検査、feedback |
| DD-14 | [無料枠・運用](14_無料枠・運用.md) | capacity、degradation、monitor、backup、runbook |
| DD-15 | [テスト・評価](15_テスト・評価.md) | test matrix、fixture、LLM eval、release gate |
| DD-16 | [実装計画・トレーサビリティ](16_実装計画・トレーサビリティ.md) | 実装順、基本設計対応、完了条件 |
| DD-17 | [実装前監査・暫定決定](17_実装前監査・暫定決定.md) | machine contract検査、旧資産判定、無確認の暫定決定 |
| DD-18 | [実装結果・ローカル検証](18_実装結果・ローカル検証.md) | 実装範囲、設計修正、検証結果、手動確認手順 |
| DD-19 | [Cloudflareサービス利用ガイド](19_Cloudflareサービス利用.md) | 利用サービス、構成図、環境差、binding、運用確認 |
| DD-20 | [メンバーシップ別LLM](20_メンバーシップ別LLM.md) | ティア、用途別モデル選択、ジョブの割当固定、移行 |

## 3. 機械可読契約

| ファイル | 用途 |
|---|---|
| [OpenAPI 3.1](api/openapi.as-built.json) | 現行routeとZodから生成する正式契約 |
| [D1初期DDL](database/001_initial.sql) | 初期migration |
| [CharacterUnderstanding Schema](schemas/character-understanding.schema.json) | キャラクター基本像のLLM出力 |
| [PreferenceAnalysis Schema](schemas/preference-analysis.schema.json) | 嗜好・価値スタンスのLLM出力 |
| [GenerationBrief Schema](schemas/generation-brief.schema.json) | 生成条件 |
| [GeneratedCharacter Schema](schemas/generated-character.schema.json) | オリジナルキャラクター出力 |
| [GraphProjection Schema](schemas/graph-projection.schema.json) | ブラウザへ渡すグラフ |

## 4. 仕様の優先順位

不整合が見つかった場合は、実装で独自解釈せずADRを追加する。優先順位は次のとおりとする。

1. ユーザー価値・内面の自由・認証不変条件
2. 本READMEとDD-00の共通規約
3. 分野別の詳細設計
4. OpenAPI、JSON Schema、DDLの機械可読契約
5. 実装中の補助コメント

機械可読契約と説明文が異なる場合は上位の意図を確認し、両方を同じ変更で修正する。

## 5. 実装開始条件

- 全分冊と機械可読契約のレビューが完了している
- 環境ごとのLLM Provider、model、OpenAIの通信経路、fallback、データ保持設定が決定している
- Cloudflareの無料枠を再確認し、DD-14の閾値を更新している
- 属性辞書初版とLLM固定評価fixtureがレビューされている
- `free_validation`の負荷モデルと登録受付モードが決定している

## 6. 実装完了の定義

- OpenAPI、Zod schema、D1 DDL、TypeScript型の一致をCIで検査できる
- DataStore StrategyのPortとD1 Adapterの契約testが通過する
- 3方式の登録から基本像確認、嗜好確認、Profile更新までをE2Eで検証できる
- ProfileSnapshotから生成、生成根拠、ExportまでをE2Eで検証できる
- 純粋悪、非道徳、善への無関心、端役、一場面限定、二次創作改変をLLM固定評価で扱える
- 無料枠の警戒、縮退、受付停止、回復を擬似テストで検証できる
- exportとaccount deletionがD1、R2、ブラウザcacheを含めて完了する
