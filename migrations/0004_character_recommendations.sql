ALTER TABLE usage_daily
ADD COLUMN recommendation_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE character_recommendation_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  workflow_id TEXT,
  result_json TEXT,
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_character_recommendations_user_created
ON character_recommendation_runs(user_id, created_at DESC);
