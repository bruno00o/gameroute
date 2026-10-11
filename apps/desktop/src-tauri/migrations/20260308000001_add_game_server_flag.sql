-- Add is_game_server flag to ip_periods.
-- Computed in real-time during capture: UDP + duration >= 30s.
ALTER TABLE ip_periods ADD COLUMN is_game_server BOOLEAN NOT NULL DEFAULT 0;

-- Backfill existing rows based on the same heuristic.
UPDATE ip_periods
SET is_game_server = 1
WHERE protocol = 'UDP'
  AND CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER) >= 30;
