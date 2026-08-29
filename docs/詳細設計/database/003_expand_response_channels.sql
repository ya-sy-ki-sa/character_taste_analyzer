-- character-preference-analysis-research.mdに基づくresponse channel拡張。
-- SQLiteはCHECK制約を直接変更できないため、既存行を保ったままtableを再構築する。
PRAGMA defer_foreign_keys = ON;

ALTER TABLE preference_assertions RENAME TO preference_assertions_legacy;
ALTER TABLE preference_value_stance_links RENAME TO preference_value_stance_links_legacy;

DROP INDEX idx_preference_assertions_owner_status;
DROP INDEX idx_preference_assertions_entry;

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
    'person_liking', 'aesthetic_liking', 'voice_performance_liking',
    'narrative_interest', 'empathy', 'admiration', 'curiosity', 'root_for',
    'protectiveness', 'motion_expression_liking', 'staging_liking',
    'character_craft_appreciation', 'actual_similarity', 'self_projection',
    'wishful_identification', 'narrative_identification',
    'complementary_attraction', 'vicarious_fulfillment', 'parasocial_closeness',
    'companionship_desire', 'guidance_seeking', 'comfort_attachment',
    'long_term_attachment', 'romantic_attraction', 'sexual_attraction',
    'sympathy', 'emotional_impact', 'meaningful_appreciation', 'humor_enjoyment',
    'identity_exploration', 'escapist_immersion', 'emotion_regulation',
    'motivation', 'self_expansion', 'moral_support',
    'fascination_with_transgression', 'love_to_hate', 'desire_no_redemption',
    'representation_affirmation', 'identity_expression', 'social_bonding',
    'creative_inspiration', 'nostalgic_attachment', 'fandom_support'
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

INSERT INTO preference_assertions (
  id, owner_user_id, analysis_run_id, entry_revision_id, character_identity_id,
  representation_id, attribute_definition_id, raw_mention_id, polarity,
  response_channel, strength, explicitness, confidence, context_json, status,
  superseded_by_id, created_at
)
SELECT
  id, owner_user_id, analysis_run_id, entry_revision_id, character_identity_id,
  representation_id, attribute_definition_id, raw_mention_id, polarity,
  response_channel, strength, explicitness, confidence, context_json, status,
  superseded_by_id, created_at
FROM preference_assertions_legacy;

CREATE INDEX idx_preference_assertions_owner_status
  ON preference_assertions (owner_user_id, status, attribute_definition_id, response_channel, id);
CREATE INDEX idx_preference_assertions_entry ON preference_assertions (entry_revision_id, created_at, id);

CREATE TABLE preference_value_stance_links (
  preference_assertion_id TEXT NOT NULL REFERENCES preference_assertions(id) ON DELETE CASCADE,
  value_stance_assertion_id TEXT NOT NULL REFERENCES value_stance_assertions(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('explains', 'qualifies', 'contrasts', 'co_occurs')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (preference_assertion_id, value_stance_assertion_id, relation_type)
);

INSERT INTO preference_value_stance_links (
  preference_assertion_id, value_stance_assertion_id, relation_type, created_at
)
SELECT preference_assertion_id, value_stance_assertion_id, relation_type, created_at
FROM preference_value_stance_links_legacy;

DROP TABLE preference_value_stance_links_legacy;
DROP TABLE preference_assertions_legacy;
