CREATE TABLE IF NOT EXISTS game_ping_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    measured_at TEXT NOT NULL,
    peer_ip TEXT,
    peer_port INTEGER,
    region TEXT,
    rtt_ms REAL,
    jitter_ms REAL,
    packets_lost INTEGER,
    packets_sent INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_ping_samples_unique ON game_ping_samples (
    session_id,
    source,
    measured_at,
    COALESCE(peer_ip, ''),
    COALESCE(peer_port, 0),
    COALESCE(region, '')
);
