PRAGMA foreign_keys = ON;

-- Auth and usage -------------------------------------------------------------

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'deleting')),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  pending_expires_at TEXT,
  activated_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (username_normalized)
);

CREATE INDEX idx_users_public_active
  ON users (username_normalized, id)
  WHERE status = 'active' AND is_public = 1 AND deleted_at IS NULL;

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_generation INTEGER NOT NULL CHECK (key_generation >= 1),
  key_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  UNIQUE (user_id, key_generation),
  UNIQUE (key_digest)
);

CREATE UNIQUE INDEX uq_credentials_one_active
  ON credentials (user_id)
  WHERE status = 'active';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL,
  csrf_digest TEXT NOT NULL,
  credential_generation INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  UNIQUE (token_digest)
);

CREATE INDEX idx_sessions_token_digest ON sessions (token_digest, expires_at);
CREATE INDEX idx_sessions_user_active ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('terms', 'privacy', 'ai_processing')),
  document_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'withdrawn')),
  decided_at TEXT NOT NULL,
  UNIQUE (user_id, consent_type, document_version, decided_at)
);

CREATE TABLE request_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_rate_limits_expires ON request_rate_limits (expires_at);

CREATE TABLE usage_daily (
  usage_date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  estimated_units INTEGER NOT NULL DEFAULT 0 CHECK (estimated_units >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_date, user_id, capability)
);

CREATE TABLE platform_usage_counters (
  usage_date TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  estimated_units INTEGER NOT NULL DEFAULT 0 CHECK (estimated_units >= 0),
  observed_units INTEGER CHECK (observed_units IS NULL OR observed_units >= 0),
  source TEXT NOT NULL CHECK (source IN ('application', 'cloudflare_api', 'operator')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_date, resource_type, operation_type)
);

CREATE TABLE idempotency_responses (
  owner_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_mode TEXT NOT NULL DEFAULT 'stored' CHECK (response_mode IN (
    'stored', 'reconstruct_registration', 'reconstruct_session',
    'reconstruct_key_rotation', 'reconstruct_deletion_status'
  )),
  response_status INTEGER NOT NULL,
  response_body_json TEXT NOT NULL,
  resource_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_scope, idempotency_key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_responses (expires_at);

-- Catalog --------------------------------------------------------------------

CREATE TABLE works (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  media_type TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  catalog_status TEXT NOT NULL CHECK (catalog_status IN ('user_created', 'reviewed', 'canonical', 'deprecated')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_works_search ON works (title_normalized, id) WHERE deleted_at IS NULL;
CREATE INDEX idx_works_owner ON works (owner_user_id, updated_at, id) WHERE deleted_at IS NULL;

CREATE TABLE work_versions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  title TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  source_note TEXT,
  content_hash TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (work_id, version_number)
);

CREATE TABLE character_identities (
  id TEXT PRIMARY KEY,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('existing', 'original')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  catalog_status TEXT NOT NULL CHECK (catalog_status IN ('user_created', 'reviewed', 'canonical', 'deprecated')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((origin_type = 'original' AND owner_user_id IS NOT NULL) OR origin_type = 'existing')
);

CREATE INDEX idx_character_identity_search
  ON character_identities (name_normalized, work_id, id) WHERE deleted_at IS NULL;
CREATE INDEX idx_character_identity_owner
  ON character_identities (owner_user_id, updated_at, id) WHERE deleted_at IS NULL;

CREATE TABLE character_representations (
  id TEXT PRIMARY KEY,
  character_identity_id TEXT NOT NULL REFERENCES character_identities(id) ON DELETE CASCADE,
  base_representation_id TEXT REFERENCES character_representations(id) ON DELETE RESTRICT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  representation_type TEXT NOT NULL CHECK (representation_type IN (
    'canonical_whole', 'media_adaptation', 'facet', 'scene_state',
    'alternate_setting', 'transformative', 'user_interpretation', 'original'
  )),
  canonicality TEXT NOT NULL CHECK (canonicality IN (
    'official', 'semi_official', 'transformative', 'user_interpretation', 'original'
  )),
  scope_type TEXT NOT NULL CHECK (scope_type IN (
    'whole', 'medium', 'period', 'facet', 'scene', 'alternate_setting'
  )),
  scope_description TEXT NOT NULL,
  transformation_summary TEXT,
  source_description TEXT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version >= 1),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (id <> base_representation_id)
);

CREATE INDEX idx_representations_identity ON character_representations (character_identity_id, id);
CREATE INDEX idx_representations_base ON character_representations (base_representation_id, id);
CREATE INDEX idx_representations_owner ON character_representations (owner_user_id, updated_at, id);

CREATE TABLE representation_relations (
  id TEXT PRIMARY KEY,
  from_representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE CASCADE,
  to_representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'adaptation_of', 'alternate_identity_of', 'inspired_by', 'contrasts_with', 'related_to'
  )),
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (from_representation_id <> to_representation_id),
  UNIQUE (from_representation_id, to_representation_id, relation_type)
);

-- Ontology -------------------------------------------------------------------

CREATE TABLE attribute_schema_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  description TEXT,
  content_hash TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_attribute_schema_active
  ON attribute_schema_versions (status) WHERE status = 'active';

CREATE TABLE attribute_definitions (
  id TEXT PRIMARY KEY,
  schema_version_id TEXT NOT NULL REFERENCES attribute_schema_versions(id) ON DELETE RESTRICT,
  stable_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'aesthetic', 'speech', 'personality', 'warmth_trust', 'agency_ability',
    'motivation', 'value_morality', 'goodness_relation', 'vulnerability',
    'duality_conflict', 'relationship', 'narrative_role', 'change_outcome',
    'expression_tone', 'response_channel', 'other'
  )),
  label TEXT NOT NULL,
  definition TEXT NOT NULL,
  vocabulary_tier TEXT NOT NULL CHECK (vocabulary_tier IN ('core_fixed', 'managed', 'emergent')),
  moral_valence TEXT NOT NULL DEFAULT 'neutral' CHECK (moral_valence IN ('good', 'evil', 'mixed', 'neutral', 'not_applicable')),
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  replacement_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (schema_version_id, stable_key),
  CHECK (id <> replacement_id)
);

CREATE INDEX idx_attribute_definitions_category ON attribute_definitions (schema_version_id, category, stable_key);

CREATE TABLE attribute_aliases (
  id TEXT PRIMARY KEY,
  attribute_definition_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'ja',
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('synonym', 'surface_form', 'historical', 'user_term')),
  created_at TEXT NOT NULL,
  UNIQUE (attribute_definition_id, locale, alias_normalized)
);

CREATE INDEX idx_attribute_alias_lookup ON attribute_aliases (locale, alias_normalized);

CREATE TABLE attribute_relations (
  id TEXT PRIMARY KEY,
  from_attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  to_attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('broader', 'narrower', 'related', 'opposed', 'often_cooccurs')),
  weight REAL CHECK (weight IS NULL OR weight BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL,
  CHECK (from_attribute_id <> to_attribute_id),
  UNIQUE (from_attribute_id, to_attribute_id, relation_type)
);

-- Sources --------------------------------------------------------------------

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official', 'primary', 'secondary', 'transformative', 'user_text', 'model_knowledge'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  citation_json TEXT NOT NULL DEFAULT '{}',
  rights_basis TEXT,
  active_revision_number INTEGER NOT NULL DEFAULT 0 CHECK (active_revision_number >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_source_documents_owner ON source_documents (owner_user_id, updated_at, id) WHERE deleted_at IS NULL;

CREATE TABLE source_document_revisions (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  original_file_name TEXT,
  object_key TEXT,
  inline_text TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_hash TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'finalized', 'rejected')),
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('pending', 'extracting', 'ready', 'failed')),
  extraction_error_code TEXT,
  finalized_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_document_id, revision_number),
  CHECK (object_key IS NOT NULL OR inline_text IS NOT NULL)
);

CREATE INDEX idx_source_revisions_object_key ON source_document_revisions (object_key) WHERE object_key IS NOT NULL;

CREATE TABLE source_fragments (
  id TEXT PRIMARY KEY,
  source_document_revision_id TEXT NOT NULL REFERENCES source_document_revisions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  locator_json TEXT NOT NULL,
  text_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (source_document_revision_id, ordinal)
);

CREATE INDEX idx_source_fragments_revision ON source_fragments (source_document_revision_id, ordinal);

CREATE TABLE source_sets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('character_understanding', 'customization', 'preference_analysis', 'generation_similarity')),
  active_version INTEGER NOT NULL DEFAULT 0 CHECK (active_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_set_versions (
  id TEXT PRIMARY KEY,
  source_set_id TEXT NOT NULL REFERENCES source_sets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_set_id, version)
);

CREATE TABLE source_set_items (
  source_set_version_id TEXT NOT NULL REFERENCES source_set_versions(id) ON DELETE CASCADE,
  source_document_revision_id TEXT NOT NULL REFERENCES source_document_revisions(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL DEFAULT 100,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('primary', 'supporting', 'contrast', 'user_definition')),
  PRIMARY KEY (source_set_version_id, source_document_revision_id)
);

-- Entries --------------------------------------------------------------------

CREATE TABLE user_character_entries (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('existing', 'customized_existing', 'original')),
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'submitted', 'understanding', 'understanding_review', 'analyzing',
    'analysis_review', 'active', 'failed', 'archived'
  )),
  active_revision_number INTEGER NOT NULL DEFAULT 0 CHECK (active_revision_number >= 0),
  active_generation INTEGER NOT NULL DEFAULT 0 CHECK (active_generation >= 0),
  draft_schema_version TEXT NOT NULL DEFAULT '1',
  draft_payload_json TEXT NOT NULL DEFAULT '{"schemaVersion":"1"}',
  draft_updated_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE INDEX idx_entries_owner_status_updated
  ON user_character_entries (owner_user_id, status, updated_at, id) WHERE deleted_at IS NULL;

CREATE TABLE entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES user_character_entries(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  source_set_version_id TEXT REFERENCES source_set_versions(id) ON DELETE RESTRICT,
  known_scope TEXT NOT NULL,
  user_character_view TEXT,
  preference_input_json TEXT NOT NULL,
  registration_payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entry_id, revision_number)
);

CREATE INDEX idx_entry_revisions_representation ON entry_revisions (representation_id, created_at, id);

CREATE TABLE entry_assets (
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  source_document_revision_id TEXT NOT NULL REFERENCES source_document_revisions(id) ON DELETE RESTRICT,
  asset_role TEXT NOT NULL CHECK (asset_role IN ('reference', 'character_sheet', 'appearance', 'scene', 'customization', 'other')),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  PRIMARY KEY (entry_revision_id, source_document_revision_id, asset_role)
);

-- Model runs and character understanding -------------------------------------

CREATE TABLE model_run_metadata (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('direct', 'ai_gateway', 'binding', 'replay', 'fake')),
  adapter_version TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  resolved_model TEXT NOT NULL,
  operation TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  provider_request_id TEXT,
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  input_token_estimate INTEGER CHECK (input_token_estimate IS NULL OR input_token_estimate >= 0),
  output_token_estimate INTEGER CHECK (output_token_estimate IS NULL OR output_token_estimate >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  finish_reason TEXT,
  data_retention_mode TEXT NOT NULL CHECK (data_retention_mode IN ('provider_default', 'no_retention', 'unknown')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_model_runs_owner_created ON model_run_metadata (owner_user_id, created_at, id);

CREATE TABLE character_understanding_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  source_set_version_id TEXT REFERENCES source_set_versions(id) ON DELETE RESTRICT,
  run_generation INTEGER NOT NULL CHECK (run_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (entry_revision_id, run_generation)
);

CREATE INDEX idx_understanding_runs_owner_status ON character_understanding_runs (owner_user_id, status, created_at, id);

CREATE TABLE character_understanding_snapshots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  understanding_run_id TEXT NOT NULL REFERENCES character_understanding_runs(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  base_snapshot_id TEXT REFERENCES character_understanding_snapshots(id) ON DELETE RESTRICT,
  source_set_version_id TEXT REFERENCES source_set_versions(id) ON DELETE RESTRICT,
  snapshot_generation INTEGER NOT NULL CHECK (snapshot_generation >= 1),
  known_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'proposed', 'needs_review', 'confirmed', 'corrected', 'provisional', 'provisional_accepted'
  )),
  overall_confidence REAL NOT NULL CHECK (overall_confidence BETWEEN 0.0 AND 1.0),
  source_assessment_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL DEFAULT '[]',
  model_run_metadata_id TEXT NOT NULL REFERENCES model_run_metadata(id) ON DELETE RESTRICT,
  ontology_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (representation_id, snapshot_generation)
);

CREATE INDEX idx_understanding_snapshots_owner ON character_understanding_snapshots (owner_user_id, representation_id, snapshot_generation);

CREATE TABLE raw_attribute_mentions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('user', 'llm', 'import')),
  source_ref_type TEXT NOT NULL,
  source_ref_id TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  raw_value TEXT,
  locale TEXT NOT NULL DEFAULT 'ja',
  normalized_label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_raw_mentions_owner_label ON raw_attribute_mentions (owner_user_id, normalized_label, id);

CREATE TABLE attribute_mappings (
  id TEXT PRIMARY KEY,
  raw_mention_id TEXT NOT NULL REFERENCES raw_attribute_mentions(id) ON DELETE CASCADE,
  attribute_definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('candidate', 'accepted', 'rejected', 'unmapped')),
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('exact', 'alias', 'embedding', 'llm', 'user', 'operator')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (raw_mention_id, attribute_definition_id, mapping_method)
);

CREATE TABLE character_assertions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES character_understanding_snapshots(id) ON DELETE CASCADE,
  attribute_definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  raw_mention_id TEXT REFERENCES raw_attribute_mentions(id) ON DELETE SET NULL,
  raw_label TEXT NOT NULL,
  value_text TEXT NOT NULL,
  assertion_kind TEXT NOT NULL CHECK (assertion_kind IN (
    'setting', 'observable_behavior', 'source_interpretation', 'user_interpretation'
  )),
  scope_json TEXT NOT NULL DEFAULT '{}',
  explicitness TEXT NOT NULL CHECK (explicitness IN (
    'source_explicit', 'source_interpreted', 'user_explicit', 'model_knowledge'
  )),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'corrected', 'rejected', 'superseded')),
  superseded_by_id TEXT REFERENCES character_assertions(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  CHECK (id <> superseded_by_id),
  CHECK (explicitness <> 'model_knowledge' OR confidence <= 0.45)
);

CREATE INDEX idx_character_assertions_snapshot ON character_assertions (snapshot_id, ordinal, id);
CREATE INDEX idx_character_assertions_owner_status ON character_assertions (owner_user_id, status, attribute_definition_id, id);

CREATE TABLE customization_deltas (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES character_understanding_snapshots(id) ON DELETE CASCADE,
  base_assertion_id TEXT REFERENCES character_assertions(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'inherit', 'add', 'modify', 'remove', 'invert', 'narrow_scope', 'emphasize', 'unspecified'
  )),
  target_attribute_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  before_value TEXT,
  after_value TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  reason_text TEXT,
  explicitness TEXT NOT NULL CHECK (explicitness IN ('user_explicit', 'inferred')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'corrected', 'rejected')),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  CHECK (operation <> 'add' OR (base_assertion_id IS NULL AND after_value IS NOT NULL)),
  CHECK (operation <> 'remove' OR (base_assertion_id IS NOT NULL AND after_value IS NULL)),
  CHECK (operation NOT IN ('modify', 'invert') OR (before_value IS NOT NULL AND after_value IS NOT NULL))
);

CREATE INDEX idx_customization_deltas_snapshot ON customization_deltas (snapshot_id, ordinal, id);

CREATE TABLE understanding_reviews (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES character_understanding_snapshots(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('snapshot', 'character_assertion', 'customization_delta')),
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('confirm', 'correct', 'reject', 'conditional')),
  correction_payload_json TEXT,
  reason_text TEXT,
  review_generation INTEGER NOT NULL CHECK (review_generation >= 1),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_understanding_reviews_target ON understanding_reviews (target_type, target_id, created_at, id);

-- Preference analysis --------------------------------------------------------

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  understanding_snapshot_id TEXT NOT NULL REFERENCES character_understanding_snapshots(id) ON DELETE RESTRICT,
  run_generation INTEGER NOT NULL CHECK (run_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  ontology_version TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (entry_revision_id, run_generation)
);

CREATE INDEX idx_analysis_runs_owner_status ON analysis_runs (owner_user_id, status, created_at, id);

CREATE TABLE preference_assertions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  character_identity_id TEXT NOT NULL REFERENCES character_identities(id) ON DELETE RESTRICT,
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  attribute_definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  raw_mention_id TEXT REFERENCES raw_attribute_mentions(id) ON DELETE SET NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative', 'mixed')),
  response_channel TEXT NOT NULL CHECK (response_channel IN (
    'aesthetic_liking', 'person_liking', 'admiration', 'empathy', 'actual_similarity',
    'wishful_identification', 'narrative_identification', 'parasocial_closeness',
    'protectiveness', 'romantic_attraction', 'sexual_attraction', 'curiosity',
    'narrative_interest', 'moral_support', 'fascination_with_transgression',
    'root_for', 'love_to_hate', 'desire_no_redemption'
  )),
  strength REAL NOT NULL CHECK (strength BETWEEN 0.0 AND 1.0),
  explicitness TEXT NOT NULL CHECK (explicitness IN ('user_explicit', 'user_confirmed', 'inferred', 'model_knowledge')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'corrected', 'rejected', 'superseded')),
  superseded_by_id TEXT REFERENCES preference_assertions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (id <> superseded_by_id),
  CHECK (explicitness <> 'model_knowledge' OR confidence <= 0.45)
);

CREATE INDEX idx_preference_assertions_owner_status
  ON preference_assertions (owner_user_id, status, attribute_definition_id, response_channel, id);
CREATE INDEX idx_preference_assertions_entry ON preference_assertions (entry_revision_id, created_at, id);

CREATE TABLE value_stance_assertions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('attribute', 'value', 'action', 'role', 'outcome', 'expression')),
  target_ref TEXT NOT NULL,
  stance TEXT NOT NULL CHECK (stance IN ('affirm', 'accept', 'indifferent', 'ambivalent', 'reject', 'unspecified')),
  orientation TEXT NOT NULL CHECK (orientation IN (
    'evil', 'immoral', 'indifferent_to_good', 'transgressive', 'self_defined', 'good', 'mixed'
  )),
  scope_json TEXT NOT NULL DEFAULT '{}',
  explicitness TEXT NOT NULL CHECK (explicitness IN ('user_explicit', 'user_confirmed', 'inferred')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'corrected', 'rejected', 'superseded')),
  superseded_by_id TEXT REFERENCES value_stance_assertions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (id <> superseded_by_id)
);

CREATE INDEX idx_value_stance_owner_status
  ON value_stance_assertions (owner_user_id, status, orientation, stance, id);

CREATE TABLE preference_value_stance_links (
  preference_assertion_id TEXT NOT NULL REFERENCES preference_assertions(id) ON DELETE CASCADE,
  value_stance_assertion_id TEXT NOT NULL REFERENCES value_stance_assertions(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('explains', 'qualifies', 'contrasts', 'co_occurs')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (preference_assertion_id, value_stance_assertion_id, relation_type)
);

CREATE TABLE evidence_fragments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN (
    'character_assertion', 'customization_delta', 'preference_assertion', 'value_stance_assertion', 'profile_pattern'
  )),
  owner_id TEXT NOT NULL,
  source_fragment_id TEXT REFERENCES source_fragments(id) ON DELETE SET NULL,
  evidence_origin TEXT NOT NULL CHECK (evidence_origin IN ('source', 'user_input', 'review', 'model_knowledge', 'derived')),
  support_type TEXT NOT NULL CHECK (support_type IN ('supports', 'contradicts', 'context')),
  quote_start INTEGER CHECK (quote_start IS NULL OR quote_start >= 0),
  quote_end INTEGER CHECK (quote_end IS NULL OR quote_end >= 0),
  quote_hash TEXT,
  excerpt_text TEXT,
  user_input_path TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL,
  CHECK (quote_start IS NULL OR quote_end IS NULL OR quote_end >= quote_start)
);

CREATE INDEX idx_evidence_owner ON evidence_fragments (owner_type, owner_id, id);
CREATE INDEX idx_evidence_source ON evidence_fragments (source_fragment_id, id);

CREATE TABLE assertion_reviews (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('preference_assertion', 'value_stance_assertion')),
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('confirm', 'correct', 'reject', 'conditional')),
  correction_payload_json TEXT,
  reason_text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_assertion_reviews_target ON assertion_reviews (target_type, target_id, created_at, id);

CREATE TABLE user_correction_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  correction_type TEXT NOT NULL CHECK (correction_type IN ('confirm', 'correct', 'reject', 'conditional', 'restore')),
  before_hash TEXT,
  after_hash TEXT,
  payload_json TEXT NOT NULL,
  causation_review_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_corrections_owner_created ON user_correction_events (owner_user_id, created_at, id);

-- Profile and browser graph --------------------------------------------------

CREATE TABLE profile_projections (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  ontology_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  evidence_set_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'current', 'superseded', 'failed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_user_id, generation)
);

CREATE UNIQUE INDEX uq_profile_current
  ON profile_projections (owner_user_id) WHERE status = 'current';

CREATE TABLE profile_dimensions (
  id TEXT PRIMARY KEY,
  profile_projection_id TEXT NOT NULL REFERENCES profile_projections(id) ON DELETE CASCADE,
  attribute_definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  raw_label TEXT,
  response_channel TEXT,
  condition_hash TEXT,
  condition_json TEXT NOT NULL DEFAULT '{}',
  positive_score REAL NOT NULL CHECK (positive_score BETWEEN 0.0 AND 1.0),
  negative_score REAL NOT NULL CHECK (negative_score BETWEEN 0.0 AND 1.0),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  identity_count INTEGER NOT NULL CHECK (identity_count >= 0),
  work_count INTEGER NOT NULL CHECK (work_count >= 0),
  classification TEXT NOT NULL CHECK (classification IN ('stable', 'emerging', 'insufficient')),
  flags_json TEXT NOT NULL DEFAULT '[]',
  rank_order INTEGER NOT NULL CHECK (rank_order >= 0),
  created_at TEXT NOT NULL,
  CHECK (attribute_definition_id IS NOT NULL OR raw_label IS NOT NULL)
);

CREATE INDEX idx_profile_dimensions_projection_rank ON profile_dimensions (profile_projection_id, rank_order, id);
CREATE INDEX idx_profile_dimensions_attribute ON profile_dimensions (attribute_definition_id, profile_projection_id, id);

CREATE TABLE profile_patterns (
  id TEXT PRIMARY KEY,
  profile_projection_id TEXT NOT NULL REFERENCES profile_projections(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'co_occurrence', 'contrast', 'conditional', 'representation_specific', 'value_stance', 'response_channel'
  )),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'shown', 'confirmed', 'rejected')),
  rank_order INTEGER NOT NULL CHECK (rank_order >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_profile_patterns_projection_rank ON profile_patterns (profile_projection_id, rank_order, id);

CREATE TABLE profile_snapshots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_projection_id TEXT NOT NULL REFERENCES profile_projections(id) ON DELETE RESTRICT,
  profile_generation INTEGER NOT NULL,
  evidence_set_hash TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  correction_version INTEGER NOT NULL CHECK (correction_version >= 0),
  content_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'profile_rebuild', 'generation', 'comparison', 'export', 'user_saved', 'migration'
  )),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_profile_snapshots_owner ON profile_snapshots (owner_user_id, created_at, id);

CREATE TABLE profile_snapshot_items (
  id TEXT PRIMARY KEY,
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id) ON DELETE CASCADE,
  source_dimension_id TEXT REFERENCES profile_dimensions(id) ON DELETE SET NULL,
  source_pattern_id TEXT REFERENCES profile_patterns(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('dimension', 'pattern', 'value_stance', 'negative_preference', 'condition')),
  stable_key TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (profile_snapshot_id, ordinal)
);

CREATE TABLE graph_projection_snapshots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_projection_id TEXT NOT NULL REFERENCES profile_projections(id) ON DELETE CASCADE,
  projection_generation INTEGER NOT NULL CHECK (projection_generation >= 1),
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  node_count INTEGER NOT NULL CHECK (node_count >= 0),
  edge_count INTEGER NOT NULL CHECK (edge_count >= 0),
  object_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('building', 'current', 'superseded', 'failed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_user_id, projection_generation)
);

CREATE UNIQUE INDEX uq_graph_projection_current
  ON graph_projection_snapshots (owner_user_id) WHERE status = 'current';

CREATE TABLE graph_projection_nodes (
  projection_snapshot_id TEXT NOT NULL REFERENCES graph_projection_snapshots(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN (
    'user', 'work', 'character_identity', 'representation', 'attribute', 'raw_attribute',
    'response_channel', 'value_stance', 'context', 'profile_pattern'
  )),
  label TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (projection_snapshot_id, node_id)
);

CREATE INDEX idx_graph_nodes_snapshot ON graph_projection_nodes (projection_snapshot_id, node_type, node_id);

CREATE TABLE graph_projection_edges (
  projection_snapshot_id TEXT NOT NULL REFERENCES graph_projection_snapshots(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK (edge_type IN (
    'likes', 'dislikes', 'has_attribute', 'in_work', 'represented_as', 'responds_via',
    'has_stance', 'conditioned_by', 'supports_pattern', 'related_attribute', 'derived_from'
  )),
  directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
  weight REAL NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (projection_snapshot_id, edge_id),
  FOREIGN KEY (projection_snapshot_id, source_node_id)
    REFERENCES graph_projection_nodes(projection_snapshot_id, node_id) ON DELETE CASCADE,
  FOREIGN KEY (projection_snapshot_id, target_node_id)
    REFERENCES graph_projection_nodes(projection_snapshot_id, node_id) ON DELETE CASCADE
);

CREATE INDEX idx_graph_edges_snapshot ON graph_projection_edges (projection_snapshot_id, source_node_id, target_node_id);

-- Generation and feedback ----------------------------------------------------

CREATE TABLE generation_requests (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_snapshot_id TEXT NOT NULL REFERENCES profile_snapshots(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('faithful', 'balanced', 'exploratory')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'brief_ready', 'generating', 'generated', 'failed', 'cancelled')),
  user_constraints_json TEXT NOT NULL DEFAULT '{}',
  brief_revision INTEGER NOT NULL DEFAULT 0 CHECK (brief_revision >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_generation_requests_owner ON generation_requests (owner_user_id, created_at, id);

CREATE TABLE generation_request_preferences (
  generation_request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  profile_snapshot_item_id TEXT NOT NULL REFERENCES profile_snapshot_items(id) ON DELETE RESTRICT,
  treatment TEXT NOT NULL CHECK (treatment IN ('required', 'include', 'weak_include', 'explore', 'omit', 'prohibit')),
  override_text TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (generation_request_id, profile_snapshot_item_id)
);

CREATE TABLE generation_briefs (
  id TEXT PRIMARY KEY,
  generation_request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  schema_version TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'needs_review')),
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (generation_request_id, revision_number)
);

CREATE TABLE generated_characters (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'generating', 'generated', 'accepted', 'needs_revision', 'failed')),
  active_revision_number INTEGER NOT NULL DEFAULT 0 CHECK (active_revision_number >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (generation_request_id)
);

CREATE TABLE generated_character_revisions (
  id TEXT PRIMARY KEY,
  generated_character_id TEXT NOT NULL REFERENCES generated_characters(id) ON DELETE CASCADE,
  generation_brief_id TEXT NOT NULL REFERENCES generation_briefs(id) ON DELETE RESTRICT,
  parent_revision_id TEXT REFERENCES generated_character_revisions(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  revision_scope TEXT NOT NULL CHECK (revision_scope IN ('full', 'identity', 'appearance', 'personality', 'values', 'relationships', 'speech', 'story_role', 'other')),
  schema_version TEXT NOT NULL,
  character_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_run_metadata_id TEXT NOT NULL REFERENCES model_run_metadata(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (generated_character_id, revision_number)
);

CREATE TABLE generation_basis_links (
  id TEXT PRIMARY KEY,
  generated_character_revision_id TEXT NOT NULL REFERENCES generated_character_revisions(id) ON DELETE CASCADE,
  profile_snapshot_item_id TEXT NOT NULL REFERENCES profile_snapshot_items(id) ON DELETE RESTRICT,
  output_json_pointer TEXT NOT NULL,
  use_type TEXT NOT NULL CHECK (use_type IN ('realized', 'combined', 'contrasted', 'avoided', 'explored')),
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (generated_character_revision_id, profile_snapshot_item_id, output_json_pointer)
);

CREATE TABLE similarity_check_results (
  id TEXT PRIMARY KEY,
  generated_character_revision_id TEXT NOT NULL REFERENCES generated_character_revisions(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK (check_type IN ('name', 'surface', 'semantic', 'combination')),
  candidate_ref_type TEXT NOT NULL CHECK (candidate_ref_type IN ('identity', 'representation', 'source_fragment', 'external_catalog')),
  candidate_ref_id TEXT NOT NULL,
  score REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
  threshold REAL NOT NULL CHECK (threshold BETWEEN 0.0 AND 1.0),
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'review', 'block')),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_similarity_revision ON similarity_check_results (generated_character_revision_id, decision, score, id);

CREATE TABLE feedback_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_character_revision_id TEXT NOT NULL REFERENCES generated_character_revisions(id) ON DELETE CASCADE,
  overall_rating INTEGER CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5),
  comment_text TEXT,
  use_for_profile INTEGER NOT NULL DEFAULT 0 CHECK (use_for_profile IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_owner_created ON feedback_events (owner_user_id, created_at, id);

CREATE TABLE feedback_attribute_ratings (
  id TEXT PRIMARY KEY,
  feedback_event_id TEXT NOT NULL REFERENCES feedback_events(id) ON DELETE CASCADE,
  attribute_definition_id TEXT REFERENCES attribute_definitions(id) ON DELETE SET NULL,
  raw_label TEXT,
  output_json_pointer TEXT,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative', 'mixed')),
  strength REAL NOT NULL CHECK (strength BETWEEN 0.0 AND 1.0),
  include_as_preference_candidate INTEGER NOT NULL DEFAULT 0 CHECK (include_as_preference_candidate IN (0, 1)),
  comment_text TEXT,
  created_at TEXT NOT NULL,
  CHECK (attribute_definition_id IS NOT NULL OR raw_label IS NOT NULL)
);

-- Jobs, outbox and audit -----------------------------------------------------

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  subject_ref_hash TEXT,
  access_token_digest TEXT,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'character_analysis', 'generation', 'profile_rebuild', 'graph_rebuild', 'export', 'account_deletion'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'waiting_for_user', 'retrying', 'succeeded', 'failed', 'superseded', 'cancelled'
  )),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  input_generation INTEGER NOT NULL DEFAULT 0 CHECK (input_generation >= 0),
  progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INTEGER NOT NULL DEFAULT 1 CHECK (progress_total >= 1),
  current_step TEXT,
  retryable INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  error_code TEXT,
  error_detail_safe TEXT,
  result_ref_json TEXT,
  workflow_instance_id TEXT,
  next_attempt_at TEXT,
  cancel_requested_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_user_id, job_type, target_type, target_id, input_generation),
  CHECK (owner_user_id IS NOT NULL OR job_type = 'account_deletion')
);

CREATE INDEX idx_jobs_owner_created ON jobs (owner_user_id, created_at, id);
CREATE INDEX idx_jobs_status_next_attempt ON jobs (status, next_attempt_at, id);

CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'abandoned')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_detail_safe TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 0),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version >= 1),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  deduplication_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'publishing', 'published', 'deferred_capacity', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX idx_outbox_delivery ON outbox_events (status, available_at, id);
CREATE INDEX idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id, aggregate_revision, id);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'operator')),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  correlation_id TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX idx_audit_owner_time ON audit_events (owner_user_id, occurred_at, id);
CREATE INDEX idx_audit_expires ON audit_events (expires_at) WHERE expires_at IS NOT NULL;
