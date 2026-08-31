-- Dark Character Taste Lab domain separation and dedicated analyzer catalog.
PRAGMA foreign_keys=OFF;

ALTER TABLE attribute_schema_versions ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
DROP INDEX uq_attribute_schema_active;
CREATE UNIQUE INDEX uq_attribute_schema_active_domain
  ON attribute_schema_versions (analysis_domain) WHERE status='active';

ALTER TABLE works ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE character_identities ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE user_character_entries ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE model_run_metadata ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE jobs ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE generation_requests ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE profile_dimensions ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE profile_snapshot_items ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE graph_projection_nodes ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));
ALTER TABLE graph_projection_edges ADD COLUMN analysis_domain TEXT NOT NULL DEFAULT 'standard'
  CHECK (analysis_domain IN ('standard','dark'));

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

ALTER TABLE preference_assertions RENAME TO preference_assertions_legacy;
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
INSERT INTO preference_assertions (
  id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
  attribute_definition_id,raw_mention_id,analysis_domain,polarity,response_channel,strength,
  explicitness,confidence,context_json,status,superseded_by_id,created_at
)
SELECT id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
       attribute_definition_id,raw_mention_id,'standard',polarity,response_channel,strength,
       explicitness,confidence,context_json,status,superseded_by_id,created_at
FROM preference_assertions_legacy;
DROP TABLE preference_assertions_legacy;
CREATE INDEX idx_preference_assertions_owner_status
  ON preference_assertions (owner_user_id,analysis_domain,status,attribute_definition_id,response_channel,id);
CREATE INDEX idx_preference_assertions_entry ON preference_assertions (entry_revision_id,created_at,id);

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

INSERT INTO attribute_schema_versions
  (id,version,status,description,content_hash,published_at,created_at,analysis_domain)
VALUES (
  'dark-ontology-v1','dark-1.0','active',
  '悪・支配・堕落・敵対状態に限定したダークキャラ嗜好ラボ専用Ontology',
  'dark-ontology-v1','2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z','dark'
);

INSERT INTO attribute_definitions
  (id,schema_version_id,stable_key,category,label,definition,vocabulary_tier,moral_valence,status,created_at)
VALUES
  ('dark:' || 'dark.archetype.villain', 'dark-ontology-v1', 'dark.archetype.villain', 'narrative_role', 'ヴィラン', 'ヴィランが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.villain_protagonist', 'dark-ontology-v1', 'dark.archetype.villain_protagonist', 'narrative_role', 'ヴィラン・プロタゴニスト', 'ヴィラン・プロタゴニストが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.antagonistic_rival', 'dark-ontology-v1', 'dark.archetype.antagonistic_rival', 'narrative_role', '悪役ライバル', '悪役ライバルが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.antihero', 'dark-ontology-v1', 'dark.archetype.antihero', 'narrative_role', 'アンチヒーロー', 'アンチヒーローが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.dark_hero', 'dark-ontology-v1', 'dark.archetype.dark_hero', 'narrative_role', 'ダークヒーロー', 'ダークヒーローが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.morally_gray', 'dark-ontology-v1', 'dark.archetype.morally_gray', 'narrative_role', 'モラリー・グレー', 'モラリー・グレーが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.fallen_hero', 'dark-ontology-v1', 'dark.archetype.fallen_hero', 'narrative_role', '堕落した英雄', '堕落した英雄が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.controlled_hero', 'dark-ontology-v1', 'dark.archetype.controlled_hero', 'narrative_role', '支配された勇者', '支配された勇者が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.manipulated_former_ally', 'dark-ontology-v1', 'dark.archetype.manipulated_former_ally', 'narrative_role', '操作された元味方', '操作された元味方が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.archetype.betraying_ally', 'dark-ontology-v1', 'dark.archetype.betraying_ally', 'narrative_role', '裏切った協力者', '裏切った協力者が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.self_chosen', 'dark-ontology-v1', 'dark.control.self_chosen', 'agency_ability', '自発的な悪', '自発的な悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.coerced', 'dark-ontology-v1', 'dark.control.coerced', 'agency_ability', '強制された悪', '強制された悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.manipulated', 'dark-ontology-v1', 'dark.control.manipulated', 'agency_ability', '心理的操作', '心理的操作が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.brainwashed', 'dark-ontology-v1', 'dark.control.brainwashed', 'agency_ability', '洗脳', '洗脳が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.possessed', 'dark-ontology-v1', 'dark.control.possessed', 'agency_ability', '憑依・乗っ取り', '憑依・乗っ取りが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.bound', 'dark-ontology-v1', 'dark.control.bound', 'agency_ability', '契約・呪縛', '契約・呪縛が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.aware', 'dark-ontology-v1', 'dark.control.aware', 'agency_ability', '支配の認識あり', '支配の認識ありが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.unaware', 'dark-ontology-v1', 'dark.control.unaware', 'agency_ability', '支配の認識なし', '支配の認識なしが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.resistant', 'dark-ontology-v1', 'dark.control.resistant', 'agency_ability', '支配への抵抗', '支配への抵抗が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.wavering', 'dark-ontology-v1', 'dark.control.wavering', 'agency_ability', '抵抗と服従の揺れ', '抵抗と服従の揺れが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.surrendered', 'dark-ontology-v1', 'dark.control.surrendered', 'agency_ability', '支配への服従', '支配への服従が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.embraced', 'dark-ontology-v1', 'dark.control.embraced', 'agency_ability', '闇・支配の受容', '闇・支配の受容が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.mixed_agency', 'dark-ontology-v1', 'dark.control.mixed_agency', 'agency_ability', '主体性が混在', '主体性が混在が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.reversible', 'dark-ontology-v1', 'dark.control.reversible', 'agency_ability', '可逆的な支配', '可逆的な支配が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.control.irreversible', 'dark-ontology-v1', 'dark.control.irreversible', 'agency_ability', '不可逆的な変化', '不可逆的な変化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.temptation', 'dark-ontology-v1', 'dark.corruption.temptation', 'change_outcome', '誘惑による闇化', '誘惑による闇化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.gradual_fall', 'dark-ontology-v1', 'dark.corruption.gradual_fall', 'change_outcome', '漸進的な堕落', '漸進的な堕落が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.sudden_fall', 'dark-ontology-v1', 'dark.corruption.sudden_fall', 'change_outcome', '急激な堕落', '急激な堕落が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.forced_fall', 'dark-ontology-v1', 'dark.corruption.forced_fall', 'change_outcome', '強制的な堕落', '強制的な堕落が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.ideological_fall', 'dark-ontology-v1', 'dark.corruption.ideological_fall', 'change_outcome', '思想的転向', '思想的転向が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.power_corruption', 'dark-ontology-v1', 'dark.corruption.power_corruption', 'change_outcome', '力による腐敗', '力による腐敗が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.relapse', 'dark-ontology-v1', 'dark.corruption.relapse', 'change_outcome', '再堕落', '再堕落が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.deepening', 'dark-ontology-v1', 'dark.corruption.deepening', 'change_outcome', '闇の深化', '闇の深化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.completed_fall', 'dark-ontology-v1', 'dark.corruption.completed_fall', 'change_outcome', '完成した堕落', '完成した堕落が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.temporary_state', 'dark-ontology-v1', 'dark.corruption.temporary_state', 'change_outcome', '一時的な闇状態', '一時的な闇状態が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.recovery', 'dark-ontology-v1', 'dark.corruption.recovery', 'change_outcome', '闇状態からの回復', '闇状態からの回復が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.corruption.permanent_change', 'dark-ontology-v1', 'dark.corruption.permanent_change', 'change_outcome', '恒久的な変化', '恒久的な変化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.retained_self', 'dark-ontology-v1', 'dark.identity.retained_self', 'duality_conflict', '自我の保持', '自我の保持が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.suppressed_self', 'dark-ontology-v1', 'dark.identity.suppressed_self', 'duality_conflict', '自我の抑圧', '自我の抑圧が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.fragmented_self', 'dark-ontology-v1', 'dark.identity.fragmented_self', 'duality_conflict', '自我の断片化', '自我の断片化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.overwritten_self', 'dark-ontology-v1', 'dark.identity.overwritten_self', 'duality_conflict', '自我の上書き', '自我の上書きが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.double_identity', 'dark-ontology-v1', 'dark.identity.double_identity', 'duality_conflict', '二重の自己', '二重の自己が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.inner_resistance', 'dark-ontology-v1', 'dark.identity.inner_resistance', 'duality_conflict', '内的抵抗', '内的抵抗が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.self_deception', 'dark-ontology-v1', 'dark.identity.self_deception', 'duality_conflict', '自己欺瞞', '自己欺瞞が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.accepted_dark_self', 'dark-ontology-v1', 'dark.identity.accepted_dark_self', 'duality_conflict', '闇の自己受容', '闇の自己受容が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.authentic_darkness', 'dark-ontology-v1', 'dark.identity.authentic_darkness', 'duality_conflict', '生来・本来の悪', '生来・本来の悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.no_conflict', 'dark-ontology-v1', 'dark.identity.no_conflict', 'duality_conflict', '葛藤のない悪', '葛藤のない悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.retained_morality', 'dark-ontology-v1', 'dark.identity.retained_morality', 'duality_conflict', '元の道徳性の残存', '元の道徳性の残存が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.identity.value_inversion', 'dark-ontology-v1', 'dark.identity.value_inversion', 'duality_conflict', '価値観の反転', '価値観の反転が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.evil_affirming', 'dark-ontology-v1', 'dark.morality.evil_affirming', 'value_morality', '悪の肯定', '悪の肯定が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.immoral', 'dark-ontology-v1', 'dark.morality.immoral', 'value_morality', '非道徳', '非道徳が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.amoral', 'dark-ontology-v1', 'dark.morality.amoral', 'value_morality', '道徳を判断軸にしない', '道徳を判断軸にしないが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.personal_code', 'dark-ontology-v1', 'dark.morality.personal_code', 'value_morality', '独自の規範', '独自の規範が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.ends_justify_means', 'dark-ontology-v1', 'dark.morality.ends_justify_means', 'value_morality', '目的による手段の正当化', '目的による手段の正当化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.selective_mercy', 'dark-ontology-v1', 'dark.morality.selective_mercy', 'value_morality', '選択的な慈悲', '選択的な慈悲が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.hypocrisy', 'dark-ontology-v1', 'dark.morality.hypocrisy', 'value_morality', '道徳的偽善', '道徳的偽善が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.self_justification', 'dark-ontology-v1', 'dark.morality.self_justification', 'value_morality', '自己正当化', '自己正当化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.nihilism', 'dark-ontology-v1', 'dark.morality.nihilism', 'value_morality', '虚無的価値観', '虚無的価値観が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.guilt', 'dark-ontology-v1', 'dark.morality.guilt', 'value_morality', '罪悪感', '罪悪感が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.remorse', 'dark-ontology-v1', 'dark.morality.remorse', 'value_morality', '後悔', '後悔が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.morality.remorseless', 'dark-ontology-v1', 'dark.morality.remorseless', 'value_morality', '無反省', '無反省が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.cruelty', 'dark-ontology-v1', 'dark.harm.cruelty', 'goodness_relation', '残酷さ', '残酷さが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.instrumental_harm', 'dark-ontology-v1', 'dark.harm.instrumental_harm', 'goodness_relation', '手段としての加害', '手段としての加害が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.intimidation', 'dark-ontology-v1', 'dark.harm.intimidation', 'goodness_relation', '威圧', '威圧が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.manipulation', 'dark-ontology-v1', 'dark.harm.manipulation', 'goodness_relation', '他者操作', '他者操作が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.exploitation', 'dark-ontology-v1', 'dark.harm.exploitation', 'goodness_relation', '搾取', '搾取が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.betrayal', 'dark-ontology-v1', 'dark.harm.betrayal', 'goodness_relation', '裏切り', '裏切りが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.domination', 'dark-ontology-v1', 'dark.harm.domination', 'goodness_relation', '他者支配', '他者支配が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.destruction', 'dark-ontology-v1', 'dark.harm.destruction', 'goodness_relation', '破壊', '破壊が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.vengeance', 'dark-ontology-v1', 'dark.harm.vengeance', 'goodness_relation', '復讐', '復讐が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.taboo_breaking', 'dark-ontology-v1', 'dark.harm.taboo_breaking', 'goodness_relation', '禁忌越境', '禁忌越境が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.harm.collateral_indifference', 'dark-ontology-v1', 'dark.harm.collateral_indifference', 'goodness_relation', '巻き添えへの無関心', '巻き添えへの無関心が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.power', 'dark-ontology-v1', 'dark.motivation.power', 'motivation', '力への欲求', '力への欲求が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.control', 'dark-ontology-v1', 'dark.motivation.control', 'motivation', '支配欲', '支配欲が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.revenge', 'dark-ontology-v1', 'dark.motivation.revenge', 'motivation', '復讐心', '復讐心が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.ideology', 'dark-ontology-v1', 'dark.motivation.ideology', 'motivation', '思想への献身', '思想への献身が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.order', 'dark-ontology-v1', 'dark.motivation.order', 'motivation', '秩序への執着', '秩序への執着が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.freedom', 'dark-ontology-v1', 'dark.motivation.freedom', 'motivation', '自由への渇望', '自由への渇望が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.survival', 'dark-ontology-v1', 'dark.motivation.survival', 'motivation', '生存', '生存が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.recognition', 'dark-ontology-v1', 'dark.motivation.recognition', 'motivation', '承認欲求', '承認欲求が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.belonging', 'dark-ontology-v1', 'dark.motivation.belonging', 'motivation', '所属欲求', '所属欲求が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.devotion', 'dark-ontology-v1', 'dark.motivation.devotion', 'motivation', '献身', '献身が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.obsession', 'dark-ontology-v1', 'dark.motivation.obsession', 'motivation', '執着', '執着が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.chaos', 'dark-ontology-v1', 'dark.motivation.chaos', 'motivation', '混沌への志向', '混沌への志向が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.motivation.pleasure', 'dark-ontology-v1', 'dark.motivation.pleasure', 'motivation', '悪や加害の快楽', '悪や加害の快楽が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.controller_subject', 'dark-ontology-v1', 'dark.relationship.controller_subject', 'relationship', '支配者と被支配者', '支配者と被支配者が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.manipulator_pawn', 'dark-ontology-v1', 'dark.relationship.manipulator_pawn', 'relationship', '操作者と駒', '操作者と駒が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.former_ally_opposition', 'dark-ontology-v1', 'dark.relationship.former_ally_opposition', 'relationship', '元味方との敵対', '元味方との敵対が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.corrupted_loyalty', 'dark-ontology-v1', 'dark.relationship.corrupted_loyalty', 'relationship', '歪んだ忠誠', '歪んだ忠誠が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.toxic_devotion', 'dark-ontology-v1', 'dark.relationship.toxic_devotion', 'relationship', '毒性的献身', '毒性的献身が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.possessiveness', 'dark-ontology-v1', 'dark.relationship.possessiveness', 'relationship', '所有・独占', '所有・独占が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.dependency', 'dark-ontology-v1', 'dark.relationship.dependency', 'relationship', '依存', '依存が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.rivalry', 'dark-ontology-v1', 'dark.relationship.rivalry', 'relationship', '宿敵関係', '宿敵関係が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.respectful_enmity', 'dark-ontology-v1', 'dark.relationship.respectful_enmity', 'relationship', '敬意を伴う敵対', '敬意を伴う敵対が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.selective_protection', 'dark-ontology-v1', 'dark.relationship.selective_protection', 'relationship', '選択的保護', '選択的保護が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.relationship.convenience_alliance', 'dark-ontology-v1', 'dark.relationship.convenience_alliance', 'relationship', '利害による同盟', '利害による同盟が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.antagonist', 'dark-ontology-v1', 'dark.role.antagonist', 'narrative_role', '敵対者', '敵対者が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.rival', 'dark-ontology-v1', 'dark.role.rival', 'narrative_role', 'ライバル', 'ライバルが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.villain_viewpoint', 'dark-ontology-v1', 'dark.role.villain_viewpoint', 'narrative_role', 'ヴィラン視点人物', 'ヴィラン視点人物が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.hidden_traitor', 'dark-ontology-v1', 'dark.role.hidden_traitor', 'narrative_role', '隠れた裏切者', '隠れた裏切者が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.fallen_ally', 'dark-ontology-v1', 'dark.role.fallen_ally', 'narrative_role', '堕落した味方', '堕落した味方が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.controlled_obstacle', 'dark-ontology-v1', 'dark.role.controlled_obstacle', 'narrative_role', '操られた障害', '操られた障害が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.temporary_enemy', 'dark-ontology-v1', 'dark.role.temporary_enemy', 'narrative_role', '一時的な敵', '一時的な敵が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.final_opponent', 'dark-ontology-v1', 'dark.role.final_opponent', 'narrative_role', '最終敵', '最終敵が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.role.gray_lead', 'dark-ontology-v1', 'dark.role.gray_lead', 'narrative_role', '灰色の主人公', '灰色の主人公が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.redemption_sought', 'dark-ontology-v1', 'dark.outcome.redemption_sought', 'change_outcome', '贖罪を求める', '贖罪を求めるが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.redemption_refused', 'dark-ontology-v1', 'dark.outcome.redemption_refused', 'change_outcome', '贖罪を拒む', '贖罪を拒むが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.redemption_irrelevant', 'dark-ontology-v1', 'dark.outcome.redemption_irrelevant', 'change_outcome', '贖罪を問題にしない', '贖罪を問題にしないが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.restored', 'dark-ontology-v1', 'dark.outcome.restored', 'change_outcome', '元の自己への回復', '元の自己への回復が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.remains_dark', 'dark-ontology-v1', 'dark.outcome.remains_dark', 'change_outcome', '闇の維持', '闇の維持が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.deepens_darkness', 'dark-ontology-v1', 'dark.outcome.deepens_darkness', 'change_outcome', '闇のさらなる深化', '闇のさらなる深化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.victory', 'dark-ontology-v1', 'dark.outcome.victory', 'change_outcome', '悪側の勝利', '悪側の勝利が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.defeat', 'dark-ontology-v1', 'dark.outcome.defeat', 'change_outcome', '敗北', '敗北が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.unpunished', 'dark-ontology-v1', 'dark.outcome.unpunished', 'change_outcome', '罰されない', '罰されないが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.tragic_end', 'dark-ontology-v1', 'dark.outcome.tragic_end', 'change_outcome', '悲劇的結末', '悲劇的結末が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.outcome.open_end', 'dark-ontology-v1', 'dark.outcome.open_end', 'change_outcome', '未決着', '未決着が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.menacing_elegance', 'dark-ontology-v1', 'dark.expression.menacing_elegance', 'expression_tone', '脅威を伴う優美さ', '脅威を伴う優美さが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.ominous_beauty', 'dark-ontology-v1', 'dark.expression.ominous_beauty', 'expression_tone', '不穏な美', '不穏な美が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.corrupted_design', 'dark-ontology-v1', 'dark.expression.corrupted_design', 'expression_tone', '闇化したデザイン', '闇化したデザインが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.transformation_contrast', 'dark-ontology-v1', 'dark.expression.transformation_contrast', 'expression_tone', '変化前後の表現対比', '変化前後の表現対比が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.uncanny_calm', 'dark-ontology-v1', 'dark.expression.uncanny_calm', 'expression_tone', '不気味な静けさ', '不気味な静けさが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.theatrical_villainy', 'dark-ontology-v1', 'dark.expression.theatrical_villainy', 'expression_tone', '芝居がかった悪', '芝居がかった悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.monstrous_form', 'dark-ontology-v1', 'dark.expression.monstrous_form', 'expression_tone', '異形化', '異形化が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.control_markers', 'dark-ontology-v1', 'dark.expression.control_markers', 'expression_tone', '支配を示す徴', '支配を示す徴が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.body_horror', 'dark-ontology-v1', 'dark.expression.body_horror', 'expression_tone', '身体変容の恐怖', '身体変容の恐怖が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.dark_humor', 'dark-ontology-v1', 'dark.expression.dark_humor', 'expression_tone', 'ダークユーモア', 'ダークユーモアが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.camp', 'dark-ontology-v1', 'dark.expression.camp', 'expression_tone', '誇張された悪役表現', '誇張された悪役表現が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.quiet_menace', 'dark-ontology-v1', 'dark.expression.quiet_menace', 'expression_tone', '静かな威圧', '静かな威圧が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.expression.dangerous_charisma', 'dark-ontology-v1', 'dark.expression.dangerous_charisma', 'expression_tone', '危険なカリスマ', '危険なカリスマが、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.strategic_mastery', 'dark-ontology-v1', 'dark.competence.strategic_mastery', 'agency_ability', '悪役的知略', '悪役的知略が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.overwhelming_power', 'dark-ontology-v1', 'dark.competence.overwhelming_power', 'agency_ability', '圧倒的な力', '圧倒的な力が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.ruthless_efficiency', 'dark-ontology-v1', 'dark.competence.ruthless_efficiency', 'agency_ability', '冷酷な効率', '冷酷な効率が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.controlled_precision', 'dark-ontology-v1', 'dark.competence.controlled_precision', 'agency_ability', '精密な遂行', '精密な遂行が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.social_control', 'dark-ontology-v1', 'dark.competence.social_control', 'agency_ability', '社会的支配力', '社会的支配力が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.institutional_power', 'dark-ontology-v1', 'dark.competence.institutional_power', 'agency_ability', '制度的権力', '制度的権力が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.underdog_threat', 'dark-ontology-v1', 'dark.competence.underdog_threat', 'agency_ability', '劣勢から生じる脅威', '劣勢から生じる脅威が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.incompetent_villainy', 'dark-ontology-v1', 'dark.competence.incompetent_villainy', 'agency_ability', '失敗する悪', '失敗する悪が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.power_escalation', 'dark-ontology-v1', 'dark.competence.power_escalation', 'agency_ability', '力の増大', '力の増大が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z'),
  ('dark:' || 'dark.competence.power_cost', 'dark-ontology-v1', 'dark.competence.power_cost', 'agency_ability', '闇の力の代償', '闇の力の代償が、悪・支配・堕落・敵対などのダーク文脈で確認できる場合に用いる。一般的特徴だけには用いない。', 'managed', 'neutral', 'active', '2026-08-31T00:00:00.000Z');

PRAGMA foreign_keys=ON;

