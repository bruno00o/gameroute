CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS ip_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    packet_count INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS traceroutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    target_ip TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    problem_hop_index INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    traceroute_id INTEGER NOT NULL,
    hop_number INTEGER NOT NULL,
    ip TEXT,
    hostname TEXT,
    latency_min REAL,
    latency_avg REAL,
    latency_max REAL,
    packet_loss REAL,
    is_problem_hop INTEGER DEFAULT 0,
    FOREIGN KEY (traceroute_id) REFERENCES traceroutes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ip_metadata (
    ip TEXT PRIMARY KEY,
    asn TEXT,
    isp TEXT,
    org TEXT,
    country TEXT,
    city TEXT,
    lat REAL,
    lon REAL,
    resolved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_periods_session_id ON ip_periods(session_id);
CREATE INDEX IF NOT EXISTS idx_ip_periods_ip ON ip_periods(ip);
CREATE INDEX IF NOT EXISTS idx_traceroutes_session_id ON traceroutes(session_id);
CREATE INDEX IF NOT EXISTS idx_traceroutes_target_ip ON traceroutes(target_ip);
CREATE INDEX IF NOT EXISTS idx_hops_traceroute_id ON hops(traceroute_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_metadata_resolved_at ON ip_metadata(resolved_at);

-- Composite index for ip_periods queries that filter by session_id and group by ip
CREATE INDEX IF NOT EXISTS idx_ip_periods_session_ip ON ip_periods(session_id, ip);

-- UNIQUE constraints to prevent duplicate data
CREATE UNIQUE INDEX IF NOT EXISTS idx_traceroutes_session_target
    ON traceroutes(session_id, target_ip);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hops_traceroute_hop
    ON hops(traceroute_id, hop_number);
