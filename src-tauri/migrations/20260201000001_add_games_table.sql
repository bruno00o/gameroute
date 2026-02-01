CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    executable_path TEXT,
    executable_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    icon_url TEXT,
    auto_detected INTEGER NOT NULL DEFAULT 0,
    monitored INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT,
    last_played_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_games_executable_name ON games(executable_name);
CREATE INDEX idx_games_source ON games(source);
CREATE INDEX idx_games_monitored ON games(monitored);
CREATE UNIQUE INDEX idx_games_source_source_id ON games(source, source_id);
