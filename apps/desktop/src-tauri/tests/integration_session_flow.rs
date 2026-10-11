//! Integration test: full session lifecycle
//!
//! Tests the end-to-end flow: session creation → IP period recording →
//! traceroute execution → hop persistence → session detail query.

use sqlx::SqlitePool;

async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory database");

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .expect("Failed to enable foreign keys");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}

#[tokio::test]
async fn test_full_session_lifecycle() {
    let pool = create_test_pool().await;

    // ── 1. Create a session ─────────────────────────────────────────────────
    let session_id: i64 =
        sqlx::query_scalar("INSERT INTO sessions (game_name, started_at) VALUES ($1, $2) RETURNING id")
            .bind("Valorant")
            .bind("2026-01-30T20:00:00Z")
            .fetch_one(&pool)
            .await
            .expect("Failed to insert session");

    assert!(session_id > 0);

    // ── 2. Record IP periods ────────────────────────────────────────────────
    sqlx::query(
        "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(session_id)
    .bind("185.60.112.157")
    .bind("2026-01-30T20:00:05Z")
    .bind("2026-01-30T20:05:00Z")
    .bind(42)
    .execute(&pool)
    .await
    .expect("Failed to insert IP period 1");

    sqlx::query(
        "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(session_id)
    .bind("104.160.131.3")
    .bind("2026-01-30T20:01:00Z")
    .bind("2026-01-30T20:04:30Z")
    .bind(27)
    .execute(&pool)
    .await
    .expect("Failed to insert IP period 2");

    // Verify unique IP count
    let unique_count: (i32,) =
        sqlx::query_as("SELECT COUNT(DISTINCT ip) FROM ip_periods WHERE session_id = $1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(unique_count.0, 2);

    // ── 3. Create traceroutes ───────────────────────────────────────────────
    let tr1_id: i64 = sqlx::query_scalar(
        "INSERT INTO traceroutes (session_id, target_ip, started_at) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(session_id)
    .bind("185.60.112.157")
    .bind("2026-01-30T20:05:01Z")
    .fetch_one(&pool)
    .await
    .expect("Failed to insert traceroute 1");

    let tr2_id: i64 = sqlx::query_scalar(
        "INSERT INTO traceroutes (session_id, target_ip, started_at) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(session_id)
    .bind("104.160.131.3")
    .bind("2026-01-30T20:05:02Z")
    .fetch_one(&pool)
    .await
    .expect("Failed to insert traceroute 2");

    // ── 4. Insert hops ──────────────────────────────────────────────────────
    let hops_tr1 = vec![
        (1, "192.168.1.1", 1.0, 1.5, 2.0, 0.0, false),
        (2, "10.0.0.1", 10.0, 12.0, 15.0, 0.0, false),
        (3, "185.60.112.157", 20.0, 25.0, 30.0, 0.0, false),
    ];

    for (hop_num, ip, lat_min, lat_avg, lat_max, loss, is_problem) in &hops_tr1 {
        sqlx::query(
            "INSERT INTO hops (traceroute_id, hop_number, ip, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(tr1_id)
        .bind(hop_num)
        .bind(ip)
        .bind(lat_min)
        .bind(lat_avg)
        .bind(lat_max)
        .bind(loss)
        .bind(is_problem)
        .execute(&pool)
        .await
        .expect("Failed to insert hop");
    }

    // Traceroute 2: has a problem hop
    let hops_tr2 = vec![
        (1, "192.168.1.1", 1.0, 1.5, 2.0, 0.0, false),
        (2, "10.0.0.1", 10.0, 80.0, 120.0, 15.0, true), // problem hop
        (3, "104.160.131.3", 30.0, 35.0, 40.0, 0.0, false),
    ];

    for (hop_num, ip, lat_min, lat_avg, lat_max, loss, is_problem) in &hops_tr2 {
        sqlx::query(
            "INSERT INTO hops (traceroute_id, hop_number, ip, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(tr2_id)
        .bind(hop_num)
        .bind(ip)
        .bind(lat_min)
        .bind(lat_avg)
        .bind(lat_max)
        .bind(loss)
        .bind(is_problem)
        .execute(&pool)
        .await
        .expect("Failed to insert hop");
    }

    // Mark traceroute 2 as having a problem hop
    sqlx::query("UPDATE traceroutes SET completed_at = $1, problem_hop_index = $2 WHERE id = $3")
        .bind("2026-01-30T20:05:30Z")
        .bind(2)
        .bind(tr2_id)
        .execute(&pool)
        .await
        .unwrap();

    // ── 5. End the session ──────────────────────────────────────────────────
    sqlx::query("UPDATE sessions SET ended_at = $1 WHERE id = $2")
        .bind("2026-01-30T20:30:00Z")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

    // ── 6. Query and verify the full session detail ─────────────────────────

    // Session
    let session: (i64, String, String, Option<String>) = sqlx::query_as(
        "SELECT id, game_name, started_at, ended_at FROM sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(session.1, "Valorant");
    assert_eq!(session.3, Some("2026-01-30T20:30:00Z".to_string()));

    // IP periods
    let ip_periods: Vec<(i64, String, i32)> =
        sqlx::query_as("SELECT id, ip, packet_count FROM ip_periods WHERE session_id = $1 ORDER BY started_at")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(ip_periods.len(), 2);
    assert_eq!(ip_periods[0].1, "185.60.112.157");
    assert_eq!(ip_periods[0].2, 42);
    assert_eq!(ip_periods[1].1, "104.160.131.3");

    // Traceroutes with hops
    let traceroutes: Vec<(i64, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, target_ip, problem_hop_index FROM traceroutes WHERE session_id = $1 ORDER BY started_at",
    )
    .bind(session_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(traceroutes.len(), 2);
    assert_eq!(traceroutes[0].1, "185.60.112.157");
    assert!(traceroutes[0].2.is_none()); // no problem hop
    assert_eq!(traceroutes[1].1, "104.160.131.3");
    assert_eq!(traceroutes[1].2, Some(2)); // problem hop at index 2

    // Hops for traceroute 1
    let hops: Vec<(i32, Option<String>, bool)> = sqlx::query_as(
        "SELECT hop_number, ip, is_problem_hop FROM hops WHERE traceroute_id = $1 ORDER BY hop_number",
    )
    .bind(tr1_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(hops.len(), 3);
    assert_eq!(hops[2].1, Some("185.60.112.157".to_string()));
    assert!(!hops[2].2); // not a problem hop

    // Problem hop in traceroute 2
    let problem_hop: Option<(i32, Option<String>, Option<f64>)> = sqlx::query_as(
        "SELECT hop_number, ip, packet_loss FROM hops WHERE traceroute_id = $1 AND is_problem_hop = 1",
    )
    .bind(tr2_id)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert!(problem_hop.is_some());
    let problem = problem_hop.unwrap();
    assert_eq!(problem.0, 2);
    assert_eq!(problem.1, Some("10.0.0.1".to_string()));
    assert_eq!(problem.2, Some(15.0));

    // ── 7. Dashboard stats ──────────────────────────────────────────────────
    let stats: (i64, i64) =
        sqlx::query_as("SELECT COUNT(*), COUNT(DISTINCT game_name) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(stats.0, 1);
    assert_eq!(stats.1, 1);
}

#[tokio::test]
async fn test_cascade_delete_removes_all_related_data() {
    let pool = create_test_pool().await;

    // Create session → IP period → traceroute → hop
    let session_id: i64 =
        sqlx::query_scalar("INSERT INTO sessions (game_name, started_at) VALUES ($1, $2) RETURNING id")
            .bind("CS2")
            .bind("2026-01-30T21:00:00Z")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query(
        "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
         VALUES ($1, '8.8.8.8', '2026-01-30T21:00:00Z', '2026-01-30T21:01:00Z', 5)",
    )
    .bind(session_id)
    .execute(&pool)
    .await
    .unwrap();

    let tr_id: i64 = sqlx::query_scalar(
        "INSERT INTO traceroutes (session_id, target_ip, started_at) VALUES ($1, '8.8.8.8', '2026-01-30T21:01:00Z') RETURNING id",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO hops (traceroute_id, hop_number, ip, is_problem_hop) VALUES ($1, 1, '1.1.1.1', 0)",
    )
    .bind(tr_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify data exists
    let hop_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hops")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(hop_count.0, 1);

    // Delete session — should CASCADE
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

    // Verify everything is gone
    let ip_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ip_periods")
        .fetch_one(&pool)
        .await
        .unwrap();
    let tr_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM traceroutes")
        .fetch_one(&pool)
        .await
        .unwrap();
    let hop_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hops")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(ip_count.0, 0);
    assert_eq!(tr_count.0, 0);
    assert_eq!(hop_count.0, 0);
}

#[tokio::test]
async fn test_multiple_sessions_isolation() {
    let pool = create_test_pool().await;

    // Create two sessions for different games
    let s1: i64 =
        sqlx::query_scalar("INSERT INTO sessions (game_name, started_at) VALUES ('Valorant', '2026-01-30T20:00:00Z') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();

    let s2: i64 =
        sqlx::query_scalar("INSERT INTO sessions (game_name, started_at) VALUES ('CS2', '2026-01-30T21:00:00Z') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();

    // Add IP periods to both
    sqlx::query(
        "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
         VALUES ($1, '1.1.1.1', '2026-01-30T20:00:00Z', '2026-01-30T20:05:00Z', 10)",
    )
    .bind(s1)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
         VALUES ($1, '2.2.2.2', '2026-01-30T21:00:00Z', '2026-01-30T21:05:00Z', 20)",
    )
    .bind(s2)
    .execute(&pool)
    .await
    .unwrap();

    // Verify isolation: each session sees only its own data
    let s1_ips: Vec<(String,)> =
        sqlx::query_as("SELECT ip FROM ip_periods WHERE session_id = $1")
            .bind(s1)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(s1_ips.len(), 1);
    assert_eq!(s1_ips[0].0, "1.1.1.1");

    let s2_ips: Vec<(String,)> =
        sqlx::query_as("SELECT ip FROM ip_periods WHERE session_id = $1")
            .bind(s2)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(s2_ips.len(), 1);
    assert_eq!(s2_ips[0].0, "2.2.2.2");

    // Delete session 1, session 2 data should survive
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(s1)
        .execute(&pool)
        .await
        .unwrap();

    let remaining: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ip_periods")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining.0, 1);

    let remaining_ip: (String,) =
        sqlx::query_as("SELECT ip FROM ip_periods LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining_ip.0, "2.2.2.2");
}
