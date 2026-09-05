-- Additive quality contracts. Existing snapshots and generated characters remain intact.
ALTER TABLE analysis_runs ADD COLUMN quality_context_json TEXT NOT NULL DEFAULT '{"schemaVersion":"1.0"}';
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
  created_at TEXT NOT NULL
);

-- Keep the review and profile rebuild atomic when two tabs submit a decision.
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
