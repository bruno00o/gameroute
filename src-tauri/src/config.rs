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
/// Matches the default of `traceroute` on Linux/macOS (5 seconds).
pub const TRACERT_PER_PROBE_TIMEOUT_MS: u64 = 5000;

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
