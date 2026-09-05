-- Keep hypothesis previews separate from the current preference analysis.
ALTER TABLE preference_refinements ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE preference_refinements ADD COLUMN hypotheses_json TEXT;
