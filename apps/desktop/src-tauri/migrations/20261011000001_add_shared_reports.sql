CREATE TABLE IF NOT EXISTS shared_reports (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    game_name TEXT NOT NULL,
    recipient TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    delete_token TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_reports_expires_at ON shared_reports(expires_at);
