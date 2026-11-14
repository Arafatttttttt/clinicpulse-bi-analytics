-- =============================================================================
-- 04_noshow_by_department.sql — Monthly no-show rate per department vs. its
--                                own trailing baseline
-- -----------------------------------------------------------------------------
-- Powers: Executive Overview → "No-Show Rate by Department" chart
--
-- Parameters: start_date, end_date, branch_id
--   (department_id is intentionally ignored: the chart compares departments.)
--
-- The trailing 3-month baseline uses a frame that EXCLUDES the current month
-- (3 PRECEDING .. 1 PRECEDING), so a spike can't hide inside its own average.
--
-- Techniques: PARTITION BY window frames, AVG() OVER, LAG(), pp deltas.
-- =============================================================================
WITH monthly AS (
    SELECT
        visit_month                                         AS month,
        department_name,
        COUNT(*) FILTER (WHERE is_no_show)                  AS no_shows,
        COUNT(*) FILTER (WHERE is_completed OR is_no_show)  AS kept_appointments
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('branch_id') IS NULL OR branch_id = getvariable('branch_id'))
    GROUP BY ALL
)

SELECT
    month,
    department_name,
    no_shows,
    kept_appointments,
    no_shows::DOUBLE / NULLIF(kept_appointments, 0)                       AS no_show_rate,
    AVG(no_shows::DOUBLE / NULLIF(kept_appointments, 0)) OVER (
        PARTITION BY department_name ORDER BY month
        ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING
    )                                                                     AS trailing_3m_rate,
    no_shows::DOUBLE / NULLIF(kept_appointments, 0)
        - LAG(no_shows::DOUBLE / NULLIF(kept_appointments, 0)) OVER (
            PARTITION BY department_name ORDER BY month
        )                                                                 AS mom_change_pp
FROM monthly
ORDER BY month, department_name;
