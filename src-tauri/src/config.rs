//! Centralized configuration constants for GameRoute.
//!
//! All tunable parameters are gathered here for easy discovery and adjustment.

use std::time::Duration;

// ── Game Detection ──────────────────────────────────────────────────────────

/// How often the game detector polls for running processes (seconds).
pub const POLL_INTERVAL_SECS: u64 = 5;

/// Maximum number of unique server IPs captured per session before stopping.
pub const MAX_CAPTURED_IPS: usize = 10_000;

/// Timeout (seconds) for a single process enumeration call. If the OS takes
/// longer than this to list processes, the poll cycle is skipped to avoid
/// blocking the monitoring loop.
pub const PROCESS_ENUMERATION_TIMEOUT_SECS: u64 = 10;

/// Number of consecutive DB failures in the detection loop before emitting a
/// prominent warning. The loop keeps running but the user gets a clear signal.
pub const MAX_CONSECUTIVE_DB_FAILURES: u32 = 10;

// ── Traceroute ──────────────────────────────────────────────────────────────

/// Maximum TTL (number of hops) per traceroute.
pub const TRACEROUTE_MAX_HOPS: u8 = 30;

/// Overall safety timeout wrapping trippy-core's own trace timeout (seconds).
pub const TRACEROUTE_TIMEOUT_SECS: u64 = 30;

/// Per-probe wait timeout for tracert.exe on Windows (milliseconds).
/// Game servers typically respond in <500ms; 2s is generous while cutting
/// max traceroute time significantly.
pub const TRACERT_PER_PROBE_TIMEOUT_MS: u64 = 2000;

/// Maximum number of concurrent traceroute jobs.
pub const TRACEROUTE_MAX_CONCURRENT: usize = 4;

/// Stop tracert.exe early after this many consecutive timeout hops.
pub const TRACERT_MAX_CONSECUTIVE_TIMEOUTS: u32 = 7;

pub const TRACE_FALLBACK_TARGET_LIMIT: usize = 5;

pub const CDN_ASNS: &[u32] = &[
    13335, 209242, 20940, 16625, 33905, 21342, 32787, 35994, 54113, 22822, 15133, 60068, 200325,
];

// ── Network Analysis ────────────────────────────────────────────────────────

/// Minimum spread (ms) between the fastest and slowest answered probes for a
/// hop to count as jittery.
pub const LATENCY_SPIKE_THRESHOLD: f64 = 50.0;

/// Minimum packet loss percentage for a hop to count as lossy.
pub const PACKET_LOSS_THRESHOLD: f64 = 10.0;

// ── Database ──────────────────────────────────────────────────────────────

/// Timeout for acquiring a connection from the SQLite pool.
pub const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

// ── Cache ───────────────────────────────────────────────────────────────────

/// Maximum age (days) for IP metadata cache entries before pruning.
pub const CACHE_MAX_TTL_DAYS: i64 = 30;

/// Maximum age (days) for completed sessions before auto-cleanup on startup.
pub const SESSION_RETENTION_DAYS: i64 = 90;

// ── Pagination ─────────────────────────────────────────────────────────────

/// Default page size when the caller provides <= 0.
pub const DEFAULT_PAGE_LIMIT: i32 = 20;

/// Hard upper bound for any paginated query.
pub const MAX_PAGE_LIMIT: i32 = 100;

// ── IP Periods ─────────────────────────────────────────────────────────────

/// Maximum gap (seconds) between two observations of the same IP before a
/// new activity period is created. Within this window the existing period
/// is extended instead.
pub const ACTIVITY_PERIOD_THRESHOLD_SECS: i64 = 10;

/// Minimum duration (seconds) for a UDP period to be flagged as a likely game server.
pub const GAME_SERVER_MIN_DURATION_SECS: i64 = 30;

// ── UDP Capture Service ───────────────────────────────────────────────────

/// Named pipe name for communication with the capture service.
pub const CAPTURE_SERVICE_PIPE_NAME: &str = r"\\.\pipe\GameRouteCaptureService";

/// Duration (seconds) to capture UDP packets per request.
pub const UDP_CAPTURE_DURATION_SECS: u32 = 3;

/// Timeout (milliseconds) for connecting to the capture service.
pub const CAPTURE_SERVICE_CONNECT_TIMEOUT_MS: u64 = 1000;

/// Timeout (milliseconds) for the entire capture operation (connect + capture + response).
pub const CAPTURE_SERVICE_TOTAL_TIMEOUT_MS: u64 = 10000;

/// Timeout (milliseconds) for a single pipe read operation before giving up.
/// Prevents blocking a thread forever if the service stops responding mid-reply.
pub const PIPE_READ_TIMEOUT_MS: u32 = 5000;

pub const PIPE_CONNECT_ATTEMPTS: u32 = 4;

pub const PIPE_BUSY_WAIT_MS: u32 = 2_000;

/// Timeout (milliseconds) for traceroute via capture service (longer than capture).
pub const TRACEROUTE_SERVICE_TIMEOUT_MS: u32 = 70_000;
