-- =============================================================================
-- 08_time_to_return.sql — Distribution of days between consecutive visits
-- -----------------------------------------------------------------------------
-- Powers: Cohort Retention → "Time to Return" histogram
--
-- Parameters: start_date, end_date, department_id, branch_id
--
-- For every completed visit, LEAD() looks ahead to the same patient's NEXT
-- completed visit. The gap is bucketed into weeks and accumulated into a CDF,
-- which tells operations when to send a "time for your follow-up" reminder.
--
-- Techniques: LEAD() OVER (PARTITION BY patient ORDER BY time),
--             DATE_DIFF, bucketing, running-share CDF, QUANTILE_CONT.
-- =============================================================================
WITH completed AS (
    SELECT
        patient_id,
        department_id,
        branch_id,
        visit_date,
        LEAD(visit_date) OVER (PARTITION BY patient_id ORDER BY scheduled_at) AS next_visit_date
    FROM fct_visits
    WHERE is_completed
),

gaps AS (
    SELECT DATE_DIFF('day', visit_date, next_visit_date) AS days_to_return
    FROM completed
    WHERE next_visit_date IS NOT NULL
      AND visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR branch_id     = getvariable('branch_id'))
),

buckets AS (
    SELECT
        LEAST(days_to_return // 7, 16)   AS week_bucket,      -- 16 = "16+ weeks"
        COUNT(*)                         AS returns
    FROM gaps
    GROUP BY 1
)

SELECT
    week_bucket,
    CASE WHEN week_bucket = 16 THEN '16+ wk' ELSE format('{}–{} wk', week_bucket, week_bucket + 1) END AS label,
    returns,
    returns::DOUBLE / SUM(returns) OVER ()                                         AS share,
    SUM(returns) OVER (ORDER BY week_bucket)::DOUBLE / SUM(returns) OVER ()        AS cumulative_share,
    (SELECT QUANTILE_CONT(days_to_return, 0.5) FROM gaps)                          AS median_days
FROM buckets
ORDER BY week_bucket;
