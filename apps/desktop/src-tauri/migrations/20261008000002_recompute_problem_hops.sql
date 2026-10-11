WITH responding AS (
    SELECT traceroute_id, hop_number, ip, packet_loss, latency_min, latency_max
    FROM hops
    WHERE latency_avg IS NOT NULL
),
hop_states AS (
    SELECT traceroute_id, hop_number, ip, 'loss' AS kind,
        COALESCE(packet_loss, 0) >= 10 AS affected
    FROM responding
    UNION ALL
    SELECT traceroute_id, hop_number, ip, 'jitter' AS kind,
        COALESCE(latency_max - latency_min >= 50, 0) AS affected
    FROM responding
),
last_clean_hop AS (
    SELECT traceroute_id, kind, MAX(hop_number) AS hop_number
    FROM hop_states
    WHERE NOT affected
    GROUP BY traceroute_id, kind
),
affected_tail AS (
    SELECT s.traceroute_id, s.kind, MIN(s.hop_number) AS onset, MAX(s.hop_number) AS last_hop, COUNT(*) AS len
    FROM hop_states s
    LEFT JOIN last_clean_hop c ON c.traceroute_id = s.traceroute_id AND c.kind = s.kind
    WHERE s.affected AND s.hop_number > COALESCE(c.hop_number, 0)
    GROUP BY s.traceroute_id, s.kind
),
onsets AS (
    SELECT a.traceroute_id, a.onset
    FROM affected_tail a
    JOIN traceroutes t ON t.id = a.traceroute_id
    JOIN responding last ON last.traceroute_id = a.traceroute_id AND last.hop_number = a.last_hop
    WHERE a.len > 1 OR last.ip = t.target_ip
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
