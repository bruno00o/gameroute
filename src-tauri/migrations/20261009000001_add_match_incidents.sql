CREATE TABLE IF NOT EXISTS match_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    server_ip TEXT NOT NULL,
    server_port INTEGER NOT NULL,
    match_started_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    cause TEXT,
    source TEXT NOT NULL,
    at_destination INTEGER NOT NULL DEFAULT 0,
    measured_hop INTEGER,
    measured_asn INTEGER,
    basis_server_ip TEXT,
    ping_ms REAL,
    usual_ms REAL,
    loss_pct REAL,
    jitter_ms REAL,
    zone TEXT,
    after_hop INTEGER,
    at_hop INTEGER,
    asn INTEGER,
    operator TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_incidents_session ON match_incidents (session_id, started_at);
