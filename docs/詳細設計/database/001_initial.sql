PRAGMA foreign_keys = ON;

-- Auth and usage -------------------------------------------------------------

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  pending_expires_at TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  membership_tier TEXT NOT NULL DEFAULT 'basic'
  CHECK (membership_tier IN ('basic', 'silver', 'gold', 'premium')),
  UNIQUE (username_normalized)
);

CREATE INDEX idx_users_public_active
  ON users (username_normalized, id)
  WHERE status = 'active' AND is_public = 1;

CREATE TABLE credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (key_digest)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL,
  csrf_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  UNIQUE (token_digest)
);

CREATE INDEX idx_sessions_token_digest ON sessions (token_digest, expires_at);
CREATE INDEX idx_sessions_user_active ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

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

-- Catalog --------------------------------------------------------------------

CREATE TABLE works (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  media_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'))
);

CREATE INDEX idx_works_search ON works (title_normalized, id);
CREATE INDEX idx_works_owner ON works (owner_user_id, updated_at, id);

CREATE TABLE character_identities (
  id TEXT PRIMARY KEY,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('existing', 'original')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
  CHECK ((origin_type = 'original' AND owner_user_id IS NOT NULL) OR origin_type = 'existing')
);

CREATE INDEX idx_character_identity_search
  ON character_identities (name_normalized, work_id, id);
CREATE INDEX idx_character_identity_owner
  ON character_identities (owner_user_id, updated_at, id);

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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (id <> base_representation_id)
);

CREATE INDEX idx_representations_identity ON character_representations (character_identity_id, id);
CREATE INDEX idx_representations_base ON character_representations (base_representation_id, id);
CREATE INDEX idx_representations_owner ON character_representations (owner_user_id, updated_at, id);

-- Ontology -------------------------------------------------------------------

CREATE TABLE attribute_schema_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  description TEXT,
  content_hash TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'))
);

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

-- Sources --------------------------------------------------------------------

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official', 'primary', 'secondary', 'transformative', 'user_text', 'model_knowledge'
  )),
  citation_json TEXT NOT NULL DEFAULT '{}',
  rights_basis TEXT,
  original_file_name TEXT,
  object_key TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_hash TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  text_content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (object_key IS NOT NULL OR text_content <> '')
);

CREATE INDEX idx_sources_owner ON sources (owner_user_id, updated_at, id);
CREATE INDEX idx_sources_object_key ON sources (object_key) WHERE object_key IS NOT NULL;

CREATE TABLE source_sets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('character_understanding', 'customization', 'preference_analysis', 'generation_similarity')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_set_items (
  source_set_id TEXT NOT NULL REFERENCES source_sets(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL DEFAULT 100,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('primary', 'supporting', 'contrast', 'user_definition')),
  PRIMARY KEY (source_set_id, source_id)
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
  creation_idempotency_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'))
);

CREATE INDEX idx_entries_owner_status_updated
  ON user_character_entries (owner_user_id, status, updated_at, id);

CREATE TABLE entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES user_character_entries(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  source_set_id TEXT REFERENCES source_sets(id) ON DELETE RESTRICT,
  preference_context TEXT,
  user_character_view TEXT,
  preference_input_json TEXT NOT NULL,
  registration_payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entry_id, revision_number)
);

CREATE INDEX idx_entry_revisions_representation ON entry_revisions (representation_id, created_at, id);

-- Model runs and character understanding -------------------------------------

CREATE TABLE model_run_metadata (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('ai_gateway', 'replay', 'fake')),
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
  root_request_id TEXT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 0),
  prompt_hash TEXT NOT NULL,
  fallback_from_provider TEXT,
  fallback_error_code TEXT,
  effective_settings_json TEXT NOT NULL DEFAULT '{}',
  ignored_parameters_json TEXT NOT NULL DEFAULT '[]',
  provider_response_diagnostics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'))
);

CREATE INDEX idx_model_runs_owner_created ON model_run_metadata (owner_user_id, created_at, id);
CREATE INDEX idx_model_runs_root_attempt ON model_run_metadata (root_request_id, attempt_number, id);

CREATE TABLE character_understanding_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  source_set_id TEXT REFERENCES source_sets(id) ON DELETE RESTRICT,
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
  source_set_id TEXT REFERENCES source_sets(id) ON DELETE RESTRICT,
  snapshot_generation INTEGER NOT NULL CHECK (snapshot_generation >= 1),
  preference_context TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'proposed', 'needs_review', 'confirmed', 'corrected', 'provisional', 'provisional_accepted'
  )),
  overall_confidence REAL NOT NULL CHECK (overall_confidence BETWEEN 0.0 AND 1.0),
  source_assessment_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL DEFAULT '[]',
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
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
  quality_context_json TEXT NOT NULL DEFAULT '{"schemaVersion":"2.1"}',
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
  analysis_domain TEXT NOT NULL DEFAULT 'standard' CHECK (analysis_domain IN ('standard','dark')),
  polarity TEXT NOT NULL CHECK (polarity IN ('positive','negative','mixed')),
  response_channel TEXT NOT NULL CHECK (response_channel IN (
    'person_liking',
    'aesthetic_liking',
    'voice_performance_liking',
    'narrative_interest',
    'empathy',
    'admiration',
    'curiosity',
    'root_for',
    'protectiveness',
    'motion_expression_liking',
    'staging_liking',
    'character_craft_appreciation',
    'actual_similarity',
    'self_projection',
    'wishful_identification',
    'narrative_identification',
    'complementary_attraction',
    'vicarious_fulfillment',
    'parasocial_closeness',
    'companionship_desire',
    'guidance_seeking',
    'comfort_attachment',
    'long_term_attachment',
    'romantic_attraction',
    'sexual_attraction',
    'sympathy',
    'emotional_impact',
    'meaningful_appreciation',
    'humor_enjoyment',
    'identity_exploration',
    'escapist_immersion',
    'emotion_regulation',
    'motivation',
    'self_expansion',
    'moral_support',
    'fascination_with_transgression',
    'love_to_hate',
    'desire_no_redemption',
    'representation_affirmation',
    'identity_expression',
    'social_bonding',
    'creative_inspiration',
    'nostalgic_attachment',
    'fandom_support',
    'dark_character_liking',
    'villain_role_fascination',
    'menacing_aesthetic_liking',
    'dark_performance_liking',
    'dark_competence_admiration',
    'power_fantasy',
    'transgression_fascination',
    'moral_distance_appreciation',
    'dark_love_to_hate',
    'root_for_dark_side',
    'villain_pov_identification',
    'vicarious_transgression',
    'dominance_fascination',
    'controlled_state_fascination',
    'corruption_arc_fascination',
    'betrayal_fascination',
    'former_ally_tragedy',
    'identity_erosion_fascination',
    'inner_resistance_fascination',
    'surrender_fascination',
    'toxic_bond_fascination',
    'selective_tenderness_contrast',
    'fear_thrill',
    'dark_curiosity',
    'rescue_restore_desire',
    'preserve_dark_state',
    'no_redemption_preference',
    'dark_outcome_interest',
    'safe_taboo_exploration',
    'dark_romantic_attraction',
    'dark_sexual_attraction',
    'dark_creative_inspiration'
  )),
  strength REAL NOT NULL CHECK (strength BETWEEN 0.0 AND 1.0),
  explicitness TEXT NOT NULL CHECK (explicitness IN ('user_explicit','user_confirmed','inferred','model_knowledge')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed','corrected','rejected','superseded')),
  superseded_by_id TEXT REFERENCES preference_assertions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (id <> superseded_by_id),
  CHECK (explicitness <> 'model_knowledge' OR confidence <= 0.45)
);

CREATE INDEX idx_preference_assertions_owner_status
  ON preference_assertions (owner_user_id,analysis_domain,status,attribute_definition_id,response_channel,id);
CREATE INDEX idx_preference_assertions_entry ON preference_assertions (entry_revision_id,created_at,id);

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

CREATE TABLE evidence_fragments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN (
    'character_assertion', 'customization_delta', 'preference_assertion', 'value_stance_assertion'
  )),
  owner_id TEXT NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  evidence_origin TEXT NOT NULL CHECK (evidence_origin IN ('source', 'user_input', 'review', 'model_knowledge', 'derived')),
  support_type TEXT NOT NULL CHECK (support_type IN ('supports', 'contradicts', 'context')),
  quote_start INTEGER CHECK (quote_start IS NULL OR quote_start >= 0),
  quote_end INTEGER CHECK (quote_end IS NULL OR quote_end >= 0),
  quote_hash TEXT,
  excerpt_text TEXT,
  user_input_path TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN (
    'verified_quote', 'source_attributed', 'model_knowledge', 'invalid'
  )),
  inference_type TEXT NOT NULL CHECK (inference_type IN ('direct', 'paraphrase', 'inferred')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL,
  CHECK (quote_start IS NULL OR quote_end IS NULL OR quote_end >= quote_start)
);

CREATE INDEX idx_evidence_owner ON evidence_fragments (owner_type, owner_id, id);
CREATE INDEX idx_evidence_source ON evidence_fragments (source_id, id);
CREATE INDEX idx_evidence_verification
  ON evidence_fragments (owner_user_id, verification_status, owner_type, owner_id);

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
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
  CHECK (attribute_definition_id IS NOT NULL OR raw_label IS NOT NULL)
);

CREATE INDEX idx_profile_dimensions_projection_rank ON profile_dimensions (profile_projection_id, rank_order, id);
CREATE INDEX idx_profile_dimensions_attribute ON profile_dimensions (attribute_definition_id, profile_projection_id, id);

CREATE TABLE profile_snapshots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_projection_id TEXT REFERENCES profile_projections(id) ON DELETE SET NULL,
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
  item_type TEXT NOT NULL CHECK (item_type IN ('dimension', 'value_stance', 'negative_preference', 'condition')),
  stable_key TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
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
    'response_channel', 'value_stance', 'context'
  )),
  label TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
  payload_json TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
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
    'has_stance', 'conditioned_by', 'derived_from'
  )),
  directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
  weight REAL NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  payload_json TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
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
  updated_at TEXT NOT NULL,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'))
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
  generation_brief_id TEXT NOT NULL REFERENCES generation_briefs(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  character_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (generation_request_id)
);

CREATE TABLE generation_basis_links (
  id TEXT PRIMARY KEY,
  generated_character_id TEXT NOT NULL REFERENCES generated_characters(id) ON DELETE CASCADE,
  profile_snapshot_item_id TEXT NOT NULL REFERENCES profile_snapshot_items(id) ON DELETE RESTRICT,
  output_json_pointer TEXT NOT NULL,
  use_type TEXT NOT NULL CHECK (use_type IN ('realized', 'combined', 'contrasted', 'avoided', 'explored')),
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (generated_character_id, profile_snapshot_item_id, output_json_pointer)
);

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

-- Jobs, outbox and audit -----------------------------------------------------

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
  quota_reservation_id TEXT REFERENCES quota_reservations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark')),
  llm_routing_snapshot_json TEXT
  CHECK (llm_routing_snapshot_json IS NULL OR json_valid(llm_routing_snapshot_json)),
  UNIQUE (owner_user_id, job_type, target_type, target_id, input_generation),
  CHECK (owner_user_id IS NOT NULL OR job_type = 'account_deletion')
);

CREATE INDEX idx_jobs_owner_created ON jobs (owner_user_id, created_at, id);
CREATE INDEX idx_jobs_status_next_attempt ON jobs (status, next_attempt_at, id);

CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  step_name TEXT NOT NULL,
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


-- Current domain and quality schema.
CREATE UNIQUE INDEX uq_attribute_schema_active_domain
  ON attribute_schema_versions (analysis_domain) WHERE status='active';

CREATE INDEX idx_entries_owner_domain_status
  ON user_character_entries (owner_user_id,analysis_domain,status,updated_at,id);

CREATE INDEX idx_works_owner_domain
  ON works (owner_user_id,analysis_domain,updated_at,id);

CREATE INDEX idx_identities_owner_domain
  ON character_identities (owner_user_id,analysis_domain,updated_at,id);

CREATE INDEX idx_jobs_owner_domain
  ON jobs (owner_user_id,analysis_domain,created_at,id);

CREATE INDEX idx_profile_dimensions_domain
  ON profile_dimensions (profile_projection_id,analysis_domain,rank_order,id);

CREATE INDEX idx_profile_snapshot_items_domain
  ON profile_snapshot_items (profile_snapshot_id,analysis_domain,ordinal,id);

CREATE INDEX idx_generation_requests_domain
  ON generation_requests (owner_user_id,analysis_domain,created_at,id);

CREATE TABLE dark_scope_assessments (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('in_scope','borderline','out_of_scope')),
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','overridden','cancelled')),
  assessment_json TEXT NOT NULL,
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (entry_revision_id)
);

CREATE INDEX idx_dark_scope_owner ON dark_scope_assessments (owner_user_id,status,created_at,id);

CREATE TABLE dark_baseline_snapshots (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES character_representations(id) ON DELETE RESTRICT,
  baseline_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entry_revision_id)
);

CREATE TABLE dark_transformation_deltas (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  understanding_snapshot_id TEXT NOT NULL REFERENCES character_understanding_snapshots(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN (
    'retained','amplified','suppressed','inverted','removed','introduced','ambiguous'
  )),
  aspect TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  detail_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (understanding_snapshot_id,ordinal)
);

CREATE INDEX idx_dark_delta_snapshot ON dark_transformation_deltas (understanding_snapshot_id,ordinal,id);

CREATE TABLE generation_candidates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  generation_brief_id TEXT NOT NULL REFERENCES generation_briefs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  model_run_metadata_id TEXT REFERENCES model_run_metadata(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed')),
  character_json TEXT,
  validation_json TEXT NOT NULL,
  similarity_json TEXT NOT NULL,
  comparison_json TEXT NOT NULL DEFAULT '{}',
  selected_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (generation_request_id,ordinal)
);

CREATE UNIQUE INDEX idx_generation_selected ON generation_candidates(generation_request_id) WHERE selected_at IS NOT NULL;

CREATE TABLE character_similarity_documents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_user_id,source_ref,content_hash,model)
);

CREATE TABLE generation_feedback (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_domain TEXT NOT NULL CHECK (analysis_domain IN ('standard','dark')),
  generated_character_id TEXT REFERENCES generated_characters(id) ON DELETE SET NULL,
  candidate_id TEXT REFERENCES generation_candidates(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  output_pointer TEXT NOT NULL,
  output_excerpt TEXT NOT NULL,
  reason TEXT NOT NULL,
  preference_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed','rejected')),
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX idx_feedback_owner_status ON generation_feedback(owner_user_id,status,analysis_domain);

CREATE TABLE preference_refinements (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_revision_id TEXT NOT NULL REFERENCES entry_revisions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('questions','hypotheses')),
  answers_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  hypotheses_json TEXT
);

CREATE TRIGGER generation_feedback_review_once BEFORE UPDATE OF status ON generation_feedback
WHEN OLD.status!='proposed'
BEGIN SELECT RAISE(ABORT,'PREFERENCE_REVIEW_STATE_CHANGED'); END;

CREATE TRIGGER preference_refinement_current_review BEFORE INSERT ON preference_refinements
WHEN NOT EXISTS (
  SELECT 1 FROM entry_revisions er JOIN user_character_entries e ON e.id=er.entry_id
  JOIN jobs j ON j.target_id=e.id AND j.target_type='entry' AND j.owner_user_id=e.owner_user_id
    AND j.input_generation=er.revision_number
  WHERE er.id=NEW.entry_revision_id AND e.owner_user_id=NEW.owner_user_id
    AND e.active_revision_number=er.revision_number AND e.status='analysis_review' AND j.status='waiting_for_user'
)
BEGIN SELECT RAISE(ABORT,'PREFERENCE_REVIEW_STATE_CHANGED'); END;
