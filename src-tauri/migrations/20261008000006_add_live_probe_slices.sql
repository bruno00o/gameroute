CREATE TABLE IF NOT EXISTS live_probe_slices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    address TEXT NOT NULL,
    host TEXT,
    ttl INTEGER,
    server_ip TEXT,
    reply_ip TEXT,
    at_destination INTEGER NOT NULL DEFAULT 0,
    region TEXT,
    provider TEXT,
    sent INTEGER NOT NULL,
    received INTEGER NOT NULL,
    rtt_min REAL,
    rtt_median REAL,
    rtt_max REAL,
    jitter_ms REAL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_probe_slices_unique ON live_probe_slices (
    session_id,
    source,
    started_at,
    address,
    COALESCE(ttl, 0)
);
