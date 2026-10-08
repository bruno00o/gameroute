WITH hop_flags AS (
    SELECT
        traceroute_id,
        hop_number,
        ip,
        latency_avg IS NOT NULL AS responded,
        COALESCE(packet_loss, 0) >= 10 AS lossy,
        latency_avg - LAG(latency_avg) OVER (PARTITION BY traceroute_id ORDER BY hop_number) AS latency_jump
    FROM hops
),
last_clean_hop AS (
    SELECT traceroute_id, MAX(hop_number) AS hop_number
    FROM hop_flags
    WHERE responded AND NOT lossy
    GROUP BY traceroute_id
),
lossy_tail AS (
    SELECT f.traceroute_id, MIN(f.hop_number) AS onset, MAX(f.hop_number) AS last_hop, COUNT(*) AS len
    FROM hop_flags f
    LEFT JOIN last_clean_hop c ON c.traceroute_id = f.traceroute_id
    WHERE f.responded AND f.lossy AND f.hop_number > COALESCE(c.hop_number, 0)
    GROUP BY f.traceroute_id
),
onsets AS (
    SELECT l.traceroute_id, l.onset
    FROM lossy_tail l
    JOIN traceroutes t ON t.id = l.traceroute_id
    JOIN hop_flags last ON last.traceroute_id = l.traceroute_id AND last.hop_number = l.last_hop
    WHERE l.len > 1 OR last.ip = t.target_ip
    UNION ALL
    SELECT traceroute_id, hop_number
    FROM hop_flags
    WHERE latency_jump >= 50
)
UPDATE traceroutes
SET problem_hop_index = (SELECT MIN(o.onset) FROM onsets o WHERE o.traceroute_id = traceroutes.id)
WHERE completed_at IS NOT NULL;

UPDATE hops
SET is_problem_hop = COALESCE(
    hop_number = (SELECT t.problem_hop_index FROM traceroutes t WHERE t.id = hops.traceroute_id),
    0
)
WHERE traceroute_id IN (SELECT id FROM traceroutes WHERE completed_at IS NOT NULL);
