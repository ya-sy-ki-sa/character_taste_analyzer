PRAGMA foreign_keys = ON;

-- Provider response and safety diagnostics ----------------------------------

ALTER TABLE model_run_metadata
  ADD COLUMN provider_response_diagnostics_json TEXT NOT NULL DEFAULT '{}';

