-- =============================================================================
-- 06_cohort_retention.sql — Monthly patient retention cohorts (Month 0 … +6)
-- -----------------------------------------------------------------------------
-- Powers: Cohort Retention → heatmap matrix + retention curve
--
-- Parameters
--   start_date, end_date  → which acquisition months form cohorts
--   department_id, branch_id → filter on the department / branch of the
--                              patient's FIRST completed visit (acquisition point)
--   channel               → acquisition channel ('Instagram', …) or NULL = all
--
-- Definitions
--   cohort_month  = month of the patient's first COMPLETED visit
--   Month N       = share of the cohort with ≥ 1 completed visit in calendar
--                   month (cohort_month + N). Month 0 is 100% by construction.
--   Cells that cannot be observed yet (cohort_month + N > last data month) are
--   removed instead of being shown as 0% — a classic right-censoring trap.
--   The "total" row (is_total = TRUE) is the cohort-size-WEIGHTED average,
--   computed in the same pass with GROUPING SETS.
--   Only NEW patients (is_new_patient) form cohorts. Legacy patients registered
--   before the data window have an unobserved first visit (left-censoring);
--   letting them in would dump the whole existing base into the first cohort.
--
-- Techniques: ARG_MIN for first-touch attributes, DATEDIFF month offsets,
--             range() grid + CROSS JOIN, GROUPING SETS, GROUPING().
-- =============================================================================
WITH first_visit AS (
    SELECT
        patient_id,
        MIN(visit_month)                         AS cohort_month,
        ARG_MIN(department_id, scheduled_at)     AS first_department_id,
        ARG_MIN(branch_id,     scheduled_at)     AS first_branch_id,
        ANY_VALUE(acquisition_channel)           AS acquisition_channel
    FROM fct_visits
    WHERE is_completed
      AND is_new_patient                         -- left-censoring guard
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
    -- Last month we can observe activity for.
    SELECT DATE_TRUNC('month', LEAST(getvariable('end_date'), MAX(visit_date)))::DATE AS last_month
    FROM fct_visits
),

monthly_activity AS (
    SELECT DISTINCT patient_id, visit_month
    FROM fct_visits
    WHERE is_completed
      AND visit_date <= getvariable('end_date')
),

cohort_activity AS (
    SELECT
        c.cohort_month,
        DATEDIFF('month', c.cohort_month, a.visit_month) AS month_offset,
        COUNT(DISTINCT a.patient_id)                     AS active_patients
    FROM cohort_members  c
    JOIN monthly_activity a USING (patient_id)
    GROUP BY ALL
),

cohort_size AS (
    SELECT cohort_month, COUNT(*) AS cohort_size
    FROM cohort_members
    GROUP BY cohort_month
),

grid AS (
    -- Every cohort × offset 0..6, keeping only observable cells.
    SELECT cs.cohort_month, cs.cohort_size, o.month_offset
    FROM cohort_size cs
    CROSS JOIN range(0, 7) AS o(month_offset)
    CROSS JOIN bounds
    WHERE cs.cohort_month + TO_MONTHS(CAST(o.month_offset AS INTEGER)) <= bounds.last_month
)

SELECT
    g.cohort_month,
    GROUPING(g.cohort_month) = 1                                      AS is_total,
    g.month_offset,
    SUM(g.cohort_size)                                                AS cohort_size,
    SUM(COALESCE(ca.active_patients, 0))                              AS active_patients,
    SUM(COALESCE(ca.active_patients, 0))::DOUBLE / SUM(g.cohort_size) AS retention_rate
FROM grid g
LEFT JOIN cohort_activity ca
       ON ca.cohort_month = g.cohort_month
      AND ca.month_offset = g.month_offset
GROUP BY GROUPING SETS ((g.cohort_month, g.month_offset), (g.month_offset))
ORDER BY is_total, g.cohort_month, g.month_offset;
