-- =============================================================================
-- 12_doctor_performance.sql — Doctor leaderboard within each department
-- -----------------------------------------------------------------------------
-- Library query (SQL Workspace). Parameters: start_date, end_date, department_id, branch_id
--
-- Ranks each doctor against peers in the SAME department (fair comparison:
-- a cardiologist's check is naturally higher than a pediatrician's).
--
--   dept_revenue_rank   DENSE_RANK by revenue inside the department
--   revenue_quartile    NTILE(4) — 1 = top quartile
--   retention_pctile    PERCENT_RANK of the doctor's 60-day patient return rate
--   vs_dept_avg_check   doctor's average check relative to the department mean
--
-- Techniques: DENSE_RANK, NTILE, PERCENT_RANK, AVG() OVER (PARTITION BY),
--             LEAD() for "did this patient come back within 60 days".
-- =============================================================================
WITH visits_with_next AS (
    SELECT
        v.*,
        LEAD(v.scheduled_at) OVER (PARTITION BY v.patient_id ORDER BY v.scheduled_at) AS next_completed_at
    FROM fct_visits v
    WHERE v.is_completed
),

per_doctor AS (
    SELECT
        d.doctor_id,
        d.full_name,
        d.seniority,
        v.department_name,
        v.branch_name,
        COUNT(*)                                                                  AS visits,
        COUNT(DISTINCT v.patient_id)                                              AS patients,
        SUM(v.net_revenue)::DOUBLE                                                AS revenue,
        AVG(v.net_revenue)::DOUBLE                                                AS avg_check,
        AVG((v.next_completed_at <= v.scheduled_at + INTERVAL 60 DAY)::INTEGER)   AS return_60d_rate
    FROM visits_with_next v
    JOIN doctors d USING (doctor_id)
    WHERE v.visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR v.department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR v.branch_id     = getvariable('branch_id'))
    GROUP BY ALL
)

SELECT
    department_name,
    DENSE_RANK()   OVER (PARTITION BY department_name ORDER BY revenue DESC)        AS dept_revenue_rank,
    full_name,
    seniority,
    branch_name,
    visits,
    patients,
    revenue,
    avg_check,
    avg_check / AVG(avg_check) OVER (PARTITION BY department_name) - 1             AS vs_dept_avg_check,
    COALESCE(return_60d_rate, 0)                                                   AS return_60d_rate,
    NTILE(4)       OVER (PARTITION BY department_name ORDER BY revenue DESC)        AS revenue_quartile,
    PERCENT_RANK() OVER (PARTITION BY department_name ORDER BY return_60d_rate)     AS retention_pctile
FROM per_doctor
ORDER BY department_name, dept_revenue_rank;
