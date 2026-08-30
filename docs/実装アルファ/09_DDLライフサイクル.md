# DDLライフサイクル

## Active

現在のroute、Workflow、Cronまたはprojection再構築から読み書きされる領域です。

- 認証・利用者: `users`, `credentials`, `sessions`, `request_rate_limits`, `idempotency_responses`, `usage_daily`
- Entry・identity・source: `works`, `character_identities`, `character_representations`, `user_character_entries`, `entry_revisions`, `source_*`
- 分析・根拠: understanding/analysis run・snapshot・assertion、`evidence_fragments`, `model_run_metadata`
- 派生データ: `profile_projections`, `profile_dimensions`, `profile_snapshots`, `profile_snapshot_items`, `graph_projection_*`, `projection_rebuild_states`
- 生成: request、brief、character revision、basis link、`generation_validation_runs`
- 非同期・quota・export: `jobs`, `job_attempts`, `outbox_events`, `quota_reservations`, `account_exports`

## Reserved

将来契約を保持するが、P0〜P2の現行導線では正本として利用しない領域です。readiness必須依存や運用アラート件数には含めません。

- `consents`, `platform_usage_counters`, `audit_events`
- `entry_assets`, `representation_relations`, `attribute_relations`
- `assertion_reviews`, `user_correction_events`, `profile_patterns`
- `similarity_check_results`, `feedback_events`, `feedback_attribute_ratings`

## Deprecated

現時点でdeprecated tableはありません。旧同期export、Entry単位review、旧healthはHTTP routeを削除済みで、DDL上の互換tableは追加していません。既存根拠は削除せず`verification_status=legacy_unverified`として明示的に読み分けます。
