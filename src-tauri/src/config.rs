//! Centralized configuration constants for GameRoute.
//!
//! All tunable parameters are gathered here for easy discovery and adjustment.

use std::time::Duration;

// ── Game Detection ──────────────────────────────────────────────────────────

/// How often the game detector polls for running processes (seconds).
pub const POLL_INTERVAL_SECS: u64 = 5;

/// Maximum number of unique server IPs captured per session before stopping.
pub const MAX_CAPTURED_IPS: usize = 10_000;

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

// ── Network Analysis ────────────────────────────────────────────────────────

/// Minimum latency increase (ms) between consecutive hops to flag as a problem hop.
pub const LATENCY_INCREASE_THRESHOLD: f64 = 50.0;

/// Minimum packet loss percentage to flag a hop as problematic.
pub const PACKET_LOSS_THRESHOLD: f64 = 10.0;

// ── ASN Resolution ──────────────────────────────────────────────────────────

/// ip-api.com batch endpoint.
pub const IP_API_BATCH_URL: &str = "http://ip-api.com/batch";

/// Maximum IPs per single API batch request.
pub const ASN_MAX_BATCH_SIZE: usize = 100;

/// In-memory LRU cache capacity for resolved IPs.
pub const ASN_MEMORY_CACHE_CAPACITY: usize = 2000;

/// Minimum interval between ip-api.com requests (rate limiting).
pub const ASN_MIN_REQUEST_INTERVAL: Duration = Duration::from_secs(4);

/// Maximum retry attempts for a failed API request.
pub const ASN_MAX_RETRIES: u32 = 2;

/// Cooldown before retrying API requests after going offline.
pub const ASN_OFFLINE_RETRY_INTERVAL: Duration = Duration::from_secs(60);

// ── Cache ───────────────────────────────────────────────────────────────────

/// Maximum age (days) for IP metadata cache entries before pruning.
pub const CACHE_MAX_TTL_DAYS: i64 = 30;

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

// ── UDP Capture Service ───────────────────────────────────────────────────

/// Named pipe name for communication with the capture service.
pub const CAPTURE_SERVICE_PIPE_NAME: &str = r"\\.\pipe\GameRouteCaptureService";

/// Duration (seconds) to capture UDP packets per request.
pub const UDP_CAPTURE_DURATION_SECS: u32 = 3;

/// Timeout (milliseconds) for connecting to the capture service.
pub const CAPTURE_SERVICE_CONNECT_TIMEOUT_MS: u64 = 1000;

/// Timeout (milliseconds) for the entire capture operation (connect + capture + response).
pub const CAPTURE_SERVICE_TOTAL_TIMEOUT_MS: u64 = 10000;

/// Timeout (milliseconds) for traceroute via capture service (longer than capture).
pub const TRACEROUTE_SERVICE_TIMEOUT_MS: u64 = 45000;
