ALTER TABLE sessions ADD COLUMN end_estimated BOOLEAN NOT NULL DEFAULT 0;

UPDATE sessions
SET end_estimated = 1
WHERE ended_at IS NOT NULL
  AND ended_at = COALESCE(
      (SELECT MAX(ended_at) FROM ip_periods WHERE session_id = sessions.id),
      started_at
  );
