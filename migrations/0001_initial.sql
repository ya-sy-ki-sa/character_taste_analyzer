PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'deleting')),
  profile_generation INTEGER NOT NULL DEFAULT 0,
  current_profile_snapshot_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  pending_expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest_hex TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, digest_hex)
);

CREATE INDEX idx_credentials_user_status ON credentials(user_id, status);

CREATE TABLE sessions (
  token_digest_hex TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_digest_hex TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_sessions_user_expires ON sessions(user_id, expires_at);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('existing', 'original')),
  identity_key TEXT,
  current_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, identity_key)
);

CREATE INDEX idx_entries_user_updated ON entries(user_id, updated_at DESC);

CREATE TABLE entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  work_title TEXT,
  character_name TEXT,
  medium_or_edition TEXT,
  overview TEXT NOT NULL,
  preference_rating INTEGER CHECK (preference_rating BETWEEN 1 AND 5),
  liked_aspects TEXT,
  disliked_aspects TEXT,
  input_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(entry_id, revision)
);

CREATE INDEX idx_entry_revisions_current ON entry_revisions(entry_id, revision DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('analysis', 'generation', 'feedback', 'deletion')),
  subject_id TEXT NOT NULL,
  profile_generation INTEGER,
  workflow_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'superseded')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, kind, idempotency_key)
);

CREATE INDEX idx_jobs_user_created ON jobs(user_id, created_at DESC);

CREATE TABLE model_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_model_runs_user_created ON model_runs(user_id, created_at DESC);

CREATE TABLE trait_assertions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  trait_id TEXT NOT NULL,
  level INTEGER CHECK (level BETWEEN 0 AND 4),
  observation TEXT NOT NULL CHECK (observation IN ('stated', 'inferred')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_field TEXT NOT NULL,
  evidence_quote TEXT NOT NULL,
  evidence_start INTEGER NOT NULL,
  evidence_end INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'manual')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_assertions_user_active ON trait_assertions(user_id, active, trait_id);
CREATE INDEX idx_assertions_revision ON trait_assertions(entry_revision_id);

CREATE TABLE free_tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  evidence_quote TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE preference_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('entry', 'correction', 'feedback')),
  source_id TEXT NOT NULL,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  trait_id TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
  strength REAL NOT NULL CHECK (strength BETWEEN 0 AND 1),
  evidence_quote TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_preference_user_active ON preference_signals(user_id, active, trait_id);

CREATE TABLE corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  trait_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'reject', 'replace')),
  replacement_trait_id TEXT,
  preference TEXT CHECK (preference IN ('positive', 'negative', 'neutral')),
  level INTEGER CHECK (level BETWEEN 0 AND 4),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_corrections_entry_created ON corrections(entry_id, created_at);

CREATE TABLE profile_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  profile_generation INTEGER NOT NULL,
  evidence_set_hash TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, version)
);

CREATE INDEX idx_profile_user_generation ON profile_snapshots(user_id, profile_generation DESC);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('faithful', 'balanced', 'surprising')),
  request_note TEXT,
  result_json TEXT,
  similarity_score REAL,
  similarity_warning TEXT,
  model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'succeeded', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_generations_user_created ON generations(user_id, created_at DESC);

CREATE TABLE feedback_revisions (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
  liked_trait_ids_json TEXT,
  disliked_trait_ids_json TEXT,
  intensity_adjustments_json TEXT,
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(generation_id, revision)
);

CREATE TABLE entry_embeddings (
  entry_revision_id TEXT PRIMARY KEY REFERENCES entry_revisions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vector_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_status TEXT NOT NULL CHECK (vector_status IN ('pending', 'synced', 'failed')),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_embeddings_user_model ON entry_embeddings(user_id, model);

CREATE TABLE generation_embeddings (
  generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vector_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  vector_status TEXT NOT NULL CHECK (vector_status IN ('pending', 'synced', 'failed')),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_generation_embeddings_user_model ON generation_embeddings(user_id, model);

CREATE TABLE taxonomy_versions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL
);

CREATE TABLE traits (
  id TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL REFERENCES taxonomy_versions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY(id, taxonomy_version)
);

CREATE TABLE usage_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  analysis_count INTEGER NOT NULL DEFAULT 0,
  generation_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, usage_date)
);

CREATE TABLE idempotency_responses (
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id TEXT,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(route, key)
);
