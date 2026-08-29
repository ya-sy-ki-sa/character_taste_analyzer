CREATE TABLE request_rate_limits (
  scope TEXT NOT NULL,
  subject_digest TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope, subject_digest, window_start)
);

CREATE INDEX idx_request_rate_limits_window ON request_rate_limits(window_start);

