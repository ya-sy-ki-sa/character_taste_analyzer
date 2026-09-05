-- Historical values are preserved, but new snapshots have no overall score.
-- Stop old writers before applying: they still reference overall_confidence.
ALTER TABLE character_understanding_snapshots
  ADD COLUMN legacy_overall_confidence REAL
    CHECK (legacy_overall_confidence BETWEEN 0.0 AND 1.0);
UPDATE character_understanding_snapshots
  SET legacy_overall_confidence = overall_confidence;
ALTER TABLE character_understanding_snapshots DROP COLUMN overall_confidence;
