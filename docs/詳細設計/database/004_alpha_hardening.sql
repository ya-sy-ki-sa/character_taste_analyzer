PRAGMA foreign_keys = ON;

-- Provenance -----------------------------------------------------------------

ALTER TABLE entry_revisions
  ADD COLUMN analysis_contract_version TEXT NOT NULL DEFAULT '1';

ALTER TABLE evidence_fragments
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'legacy_unverified'
  CHECK (verification_status IN (
    'verified_quote', 'source_attributed', 'model_knowledge', 'legacy_unverified', 'invalid'
  ));

ALTER TABLE evidence_fragments
  ADD COLUMN inference_type TEXT NOT NULL DEFAULT 'direct'
  CHECK (inference_type IN ('direct', 'paraphrase', 'inferred'));

ALTER TABLE evidence_fragments
  ADD COLUMN provenance_schema_version TEXT NOT NULL DEFAULT '1';

CREATE INDEX idx_evidence_verification
  ON evidence_fragments (owner_user_id, verification_status, owner_type, owner_id);

-- LLM attempt observability --------------------------------------------------

ALTER TABLE model_run_metadata ADD COLUMN root_request_id TEXT;
ALTER TABLE model_run_metadata
  ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (attempt_number >= 0);
ALTER TABLE model_run_metadata ADD COLUMN prompt_hash TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE model_run_metadata ADD COLUMN fallback_from_provider TEXT;
ALTER TABLE model_run_metadata ADD COLUMN fallback_error_code TEXT;
ALTER TABLE model_run_metadata ADD COLUMN effective_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE model_run_metadata ADD COLUMN ignored_parameters_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_model_runs_root_attempt
  ON model_run_metadata (root_request_id, attempt_number, id);

-- Job claims, quota reservations and projection freshness -------------------

ALTER TABLE job_attempts ADD COLUMN step_name TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX idx_job_attempts_step
  ON job_attempts (job_id, step_name, attempt_number);

CREATE TABLE quota_reservations (
  id TEXT PRIMARY KEY,
  usage_date TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL CHECK (capability IN ('analysis', 'generation', 'export')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  slot_number INTEGER NOT NULL CHECK (slot_number >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (usage_date, owner_user_id, capability, slot_number),
  UNIQUE (owner_user_id, capability, idempotency_key)
);

CREATE INDEX idx_quota_reservations_owner_day
  ON quota_reservations (owner_user_id, usage_date, capability, slot_number);

ALTER TABLE jobs
  ADD COLUMN quota_reservation_id TEXT REFERENCES quota_reservations(id) ON DELETE SET NULL;

CREATE TABLE projection_rebuild_states (
  owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  desired_generation INTEGER NOT NULL DEFAULT 0 CHECK (desired_generation >= 0),
  built_generation INTEGER NOT NULL DEFAULT 0 CHECK (built_generation >= 0),
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'queued', 'building', 'current', 'failed')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  CHECK (built_generation <= desired_generation)
);

CREATE INDEX idx_projection_rebuild_pending
  ON projection_rebuild_states (status, desired_generation, built_generation, updated_at);

INSERT INTO projection_rebuild_states
  (owner_user_id, desired_generation, built_generation, status, updated_at)
SELECT u.id,
       COALESCE((SELECT MAX(generation) FROM profile_projections p WHERE p.owner_user_id=u.id), 0),
       COALESCE((SELECT MAX(generation) FROM profile_projections p WHERE p.owner_user_id=u.id AND p.status='current'), 0),
       CASE WHEN EXISTS (
         SELECT 1 FROM profile_projections p WHERE p.owner_user_id=u.id AND p.status='current'
       ) THEN 'current' ELSE 'idle' END,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users u;

-- Asynchronous account exports ---------------------------------------------

CREATE TABLE account_exports (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  schema_version TEXT NOT NULL,
  object_key TEXT,
  content_hash TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);

CREATE INDEX idx_account_exports_owner_created
  ON account_exports (owner_user_id, created_at, id);
CREATE INDEX idx_account_exports_expiry
  ON account_exports (status, expires_at, id);

-- Generation verification ---------------------------------------------------

CREATE TABLE generation_validation_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('initial', 'repaired')),
  candidate_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'violated', 'invalid')),
  report_json TEXT NOT NULL,
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (generation_request_id, stage)
);

CREATE INDEX idx_generation_validation_request
  ON generation_validation_runs (generation_request_id, stage, id);
