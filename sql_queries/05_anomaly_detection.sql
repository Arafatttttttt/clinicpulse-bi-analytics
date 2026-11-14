-- =============================================================================
-- 05_anomaly_detection.sql — Automated insight engine
-- -----------------------------------------------------------------------------
-- Powers: Executive Overview → "Automated Insights" panel
--
-- Parameters: start_date, end_date   (scans ALL departments and branches)
--
-- Approach
--   1. Build several "health" series in one long table (UNION ALL), each a
--      proportion oriented so that HIGHER = WORSE, carried as counts
--      (events / volume) so they can be pooled correctly:
--        • no-show rate          per department per month
--        • unconfirmed bookings  per branch     per month
--        • cancellation rate     per department per month
--   2. Compare every month with the segment's own trailing 3 months
--      (current month excluded from the frame). The baseline is
--      VOLUME-WEIGHTED (Σ events / Σ volume), not an average of rates.
--   3. Score with a two-proportion z-test (pooled variance):
--        z = (p₁ − p₀) / √( p̂ (1 − p̂) (1/n₁ + 1/n₀) )
--   4. Keep each segment's single worst month (QUALIFY) and estimate the
--      monthly revenue at risk.
--   ~200 segment-months are tested at once, so the dashboard only surfaces
--   moves that are both material (≥ 4 pp) and extreme (z ≥ 4) — a
--   conservative guard against multiple-testing false alarms.
--
-- Techniques: UNION ALL long-format series, SUM() OVER sliding frames,
--             two-proportion z-test, QUALIFY + ROW_NUMBER(), arg-max per group.
-- =============================================================================
WITH base AS (
    SELECT *
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
),

series AS (
    SELECT
        'No-show rate'                                      AS metric,
        'Department'                                        AS segment_type,
        department_name                                     AS segment,
        visit_month                                         AS month,
        COUNT(*) FILTER (WHERE is_no_show)                  AS events,
        COUNT(*) FILTER (WHERE is_completed OR is_no_show)  AS volume,
        AVG(billed_amount - discount)::DOUBLE               AS avg_ticket
    FROM base GROUP BY ALL

    UNION ALL

    SELECT
        'Unconfirmed bookings', 'Branch', branch_name, visit_month,
        COUNT(*) FILTER (WHERE NOT is_confirmed),
        COUNT(*),
        AVG(billed_amount - discount)::DOUBLE
    FROM base GROUP BY ALL

    UNION ALL

    SELECT
        'Cancellation rate', 'Department', department_name, visit_month,
        COUNT(*) FILTER (WHERE status = 'cancelled'),
        COUNT(*),
        AVG(billed_amount - discount)::DOUBLE
    FROM base GROUP BY ALL
),

scored AS (
    SELECT
        *,
        events::DOUBLE / volume  AS p1,
        SUM(events) OVER w       AS baseline_events,
        SUM(volume) OVER w       AS baseline_volume,
        COUNT(*)    OVER w       AS baseline_points
    FROM series
    WINDOW w AS (PARTITION BY metric, segment ORDER BY month ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING)
),

tested AS (
    SELECT
        *,
        baseline_events::DOUBLE / baseline_volume                              AS p0,
        (events + baseline_events)::DOUBLE / (volume + baseline_volume)        AS p_pool
    FROM scored
    WHERE baseline_points = 3
      AND volume >= 40
)

SELECT
    metric,
    segment_type,
    segment,
    month                                                     AS detected_month,
    p1                                                        AS value,
    p0                                                        AS baseline,
    p1 - p0                                                   AS delta_pp,
    (p1 - p0) / NULLIF(SQRT(p_pool * (1 - p_pool) * (1.0 / volume + 1.0 / baseline_volume)), 0)
                                                              AS z_score,
    volume,
    -- Extra bad events vs. baseline × average ticket = monthly revenue at risk
    GREATEST(p1 - p0, 0) * volume * avg_ticket                AS est_revenue_at_risk
FROM tested
QUALIFY ROW_NUMBER() OVER (PARTITION BY metric, segment ORDER BY p1 - p0 DESC) = 1
ORDER BY z_score DESC
LIMIT 6;
