ALTER TABLE users ADD COLUMN membership_tier TEXT NOT NULL DEFAULT 'basic'
  CHECK (membership_tier IN ('basic', 'silver', 'gold', 'premium'));

-- NULL identifies a job created before membership routing was introduced.
-- Includes only resolved routes and policy; credentials remain in Worker bindings.
ALTER TABLE jobs ADD COLUMN llm_routing_snapshot_json TEXT
  CHECK (llm_routing_snapshot_json IS NULL OR json_valid(llm_routing_snapshot_json));
