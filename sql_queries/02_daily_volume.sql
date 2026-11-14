-- =============================================================================
-- 02_daily_volume.sql — Daily attended visits with 7-day moving average
-- -----------------------------------------------------------------------------
-- Powers: Executive Overview → "Daily Visit Volume" chart
--
-- Parameters: start_date, end_date, department_id, branch_id (see 01_kpi_monthly.sql)
--
-- Why a calendar spine? Days with zero visits (e.g. holidays) would silently
-- disappear from a plain GROUP BY and distort the moving average. We generate
-- every calendar day first and LEFT JOIN the facts onto it.
--
-- Techniques: generate_series() date spine, LEFT JOIN gap-filling,
--             moving average with ROWS BETWEEN 6 PRECEDING AND CURRENT ROW,
--             running total, weekday flags.
-- =============================================================================
WITH calendar AS (
    SELECT CAST(ts AS DATE) AS day
    FROM generate_series(
        CAST(getvariable('start_date') AS TIMESTAMP),
        CAST(getvariable('end_date')   AS TIMESTAMP),
        INTERVAL 1 DAY
    ) AS t(ts)
),

daily AS (
    SELECT
        visit_date                                    AS day,
        COUNT(*) FILTER (WHERE is_completed)          AS visits,
        COUNT(*) FILTER (WHERE is_no_show)            AS no_shows,
        SUM(net_revenue)::DOUBLE                      AS revenue
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR branch_id     = getvariable('branch_id'))
    GROUP BY visit_date
)

SELECT
    c.day,
    dayname(c.day)                                           AS weekday,
    isodow(c.day) IN (6, 7)                                  AS is_weekend,
    COALESCE(d.visits, 0)                                    AS visits,
    COALESCE(d.no_shows, 0)                                  AS no_shows,
    COALESCE(d.revenue, 0)                                   AS revenue,
    AVG(COALESCE(d.visits, 0)) OVER (
        ORDER BY c.day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )                                                        AS visits_7d_avg,
    SUM(COALESCE(d.revenue, 0)) OVER (
        ORDER BY c.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )                                                        AS revenue_running_total
FROM calendar c
LEFT JOIN daily d USING (day)
ORDER BY c.day;
