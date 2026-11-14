-- =============================================================================
-- 11_funnel_trend.sql — Monthly booking-level conversion by branch & department
-- -----------------------------------------------------------------------------
-- Powers: Conversion Funnel → "Conversion Trend" chart
--
-- Parameters: start_date, end_date
--
-- Unlike the patient-journey funnel (first booking only), this looks at ALL
-- bookings so that operational regressions show up the month they happen:
--   confirm_rate = confirmed bookings / bookings
--   attend_rate  = attended / confirmed bookings
--
-- Techniques: GROUPING SETS over (month, branch) and (month, department),
--             AVG(boolean::INT) rate idiom, LAG() pp change.
-- =============================================================================
WITH monthly AS (
    SELECT
        visit_month                                         AS month,
        CASE WHEN GROUPING(branch_name) = 0 THEN 'branch' ELSE 'department' END AS dimension,
        COALESCE(branch_name, department_name)              AS segment,
        COUNT(*)                                            AS bookings,
        AVG(is_confirmed::INTEGER)                          AS confirm_rate,
        AVG(is_completed::INTEGER) FILTER (WHERE is_confirmed) AS attend_rate
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
    GROUP BY GROUPING SETS ((visit_month, branch_name), (visit_month, department_name))
)

SELECT
    month,
    dimension,
    segment,
    bookings,
    confirm_rate,
    attend_rate,
    confirm_rate - LAG(confirm_rate) OVER (PARTITION BY dimension, segment ORDER BY month) AS confirm_rate_mom_pp,
    attend_rate  - LAG(attend_rate)  OVER (PARTITION BY dimension, segment ORDER BY month) AS attend_rate_mom_pp
FROM monthly
ORDER BY dimension, segment, month;
