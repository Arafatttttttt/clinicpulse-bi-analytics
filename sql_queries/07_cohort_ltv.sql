-- =============================================================================
-- 07_cohort_ltv.sql — Cumulative revenue per acquired patient (cohort LTV curve)
-- -----------------------------------------------------------------------------
-- Powers: Cohort Retention → "Cumulative LTV" view of the heatmap
--
-- Parameters: start_date, end_date, department_id, branch_id, channel
--             (same cohort definition as 06_cohort_retention.sql)
--
-- LTV(N) = Σ net revenue from the cohort in months 0..N  /  cohort size
-- Compare LTV(N) with the acquisition cost of each channel to get payback.
--
-- Techniques: running total SUM() OVER (PARTITION BY … ORDER BY …),
--             grid densification so months with zero revenue still accumulate.
-- =============================================================================
WITH first_visit AS (
    SELECT
        patient_id,
        MIN(visit_month)                     AS cohort_month,
        ARG_MIN(department_id, scheduled_at) AS first_department_id,
        ARG_MIN(branch_id,     scheduled_at) AS first_branch_id,
        ANY_VALUE(acquisition_channel)       AS acquisition_channel
    FROM fct_visits
    WHERE is_completed
      AND is_new_patient                     -- left-censoring guard (see 06)
    GROUP BY patient_id
),

cohort_members AS (
    SELECT *
    FROM first_visit
    WHERE cohort_month BETWEEN DATE_TRUNC('month', getvariable('start_date')) AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR first_department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR first_branch_id     = getvariable('branch_id'))
      AND (getvariable('channel')       IS NULL OR acquisition_channel = getvariable('channel'))
),

bounds AS (
    SELECT DATE_TRUNC('month', LEAST(getvariable('end_date'), MAX(visit_date)))::DATE AS last_month
    FROM fct_visits
),

cohort_revenue AS (
    SELECT
        c.cohort_month,
        DATEDIFF('month', c.cohort_month, v.visit_month) AS month_offset,
        SUM(v.net_revenue)::DOUBLE                       AS revenue
    FROM cohort_members c
    JOIN fct_visits v USING (patient_id)
    WHERE v.is_completed AND v.visit_date <= getvariable('end_date')
    GROUP BY ALL
),

cohort_size AS (
    SELECT cohort_month, COUNT(*) AS cohort_size FROM cohort_members GROUP BY 1
),

grid AS (
    SELECT cs.cohort_month, cs.cohort_size, o.month_offset
    FROM cohort_size cs
    CROSS JOIN range(0, 7) AS o(month_offset)
    CROSS JOIN bounds
    WHERE cs.cohort_month + TO_MONTHS(CAST(o.month_offset AS INTEGER)) <= bounds.last_month
)

SELECT
    g.cohort_month,
    g.month_offset,
    g.cohort_size,
    COALESCE(r.revenue, 0)                                          AS revenue_in_month,
    SUM(COALESCE(r.revenue, 0)) OVER (
        PARTITION BY g.cohort_month ORDER BY g.month_offset
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) / g.cohort_size                                               AS cumulative_ltv
FROM grid g
LEFT JOIN cohort_revenue r
       ON r.cohort_month = g.cohort_month
      AND r.month_offset = g.month_offset
ORDER BY g.cohort_month, g.month_offset;
