-- =============================================================================
-- 01_kpi_monthly.sql — Executive KPIs per month with Month-over-Month deltas
-- -----------------------------------------------------------------------------
-- Powers: Executive Overview → KPI cards + "Revenue & contribution" chart
--
-- Parameters (DuckDB session variables — the app sets them before each run;
-- run these lines yourself when executing the file standalone):
--   SET VARIABLE start_date    = DATE '2025-11-01';
--   SET VARIABLE end_date      = DATE '2026-10-31';
--   SET VARIABLE department_id = NULL;   -- NULL = all departments
--   SET VARIABLE branch_id     = NULL;   -- NULL = all branches
--
-- Metric definitions
--   revenue          = Σ (billed − discount) of completed visits (accrual, by visit date)
--   active_patients  = distinct patients with ≥ 1 completed visit in the month
--   avg_check        = revenue / completed visits
--   arpu             = revenue / active patients
--   no_show_rate     = no-shows / (completed + no-shows)   — cancellations excluded
--   net_margin       = (revenue − direct service cost − doctor commission) / revenue
--
-- Techniques: FILTER aggregates, named WINDOW, LAG() for MoM deltas,
--             ratio deltas in % and rate deltas in percentage points.
-- =============================================================================
WITH filtered AS (
    SELECT *
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR branch_id     = getvariable('branch_id'))
),

monthly AS (
    SELECT
        visit_month                                              AS month,
        SUM(net_revenue)                                         AS revenue,
        COUNT(DISTINCT patient_id) FILTER (WHERE is_completed)   AS active_patients,
        COUNT(*)                   FILTER (WHERE is_completed)   AS completed_visits,
        COUNT(*)                   FILTER (WHERE is_no_show)     AS no_shows,
        SUM(service_cost)                                        AS service_cost,
        SUM(doctor_commission)                                   AS doctor_commission
    FROM filtered
    GROUP BY visit_month
),

kpis AS (
    SELECT
        month,
        revenue::DOUBLE                                                        AS revenue,
        active_patients,
        completed_visits,
        revenue::DOUBLE / NULLIF(completed_visits, 0)                          AS avg_check,
        revenue::DOUBLE / NULLIF(active_patients, 0)                           AS arpu,
        no_shows::DOUBLE / NULLIF(completed_visits + no_shows, 0)              AS no_show_rate,
        (revenue - service_cost - doctor_commission)::DOUBLE                   AS contribution,
        (revenue - service_cost - doctor_commission)::DOUBLE / NULLIF(revenue, 0) AS net_margin
    FROM monthly
)

SELECT
    month,
    revenue,
    active_patients,
    completed_visits,
    avg_check,
    arpu,
    no_show_rate,
    contribution,
    net_margin,
    -- Month-over-Month: relative change for volumes / money …
    revenue         / LAG(revenue)         OVER w - 1  AS revenue_mom,
    active_patients / LAG(active_patients) OVER w - 1  AS active_patients_mom,
    avg_check       / LAG(avg_check)       OVER w - 1  AS avg_check_mom,
    arpu            / LAG(arpu)            OVER w - 1  AS arpu_mom,
    -- … and absolute change (percentage points) for rates.
    no_show_rate    - LAG(no_show_rate)    OVER w      AS no_show_rate_mom_pp,
    net_margin      - LAG(net_margin)      OVER w      AS net_margin_mom_pp,
    -- Running total gives a YTD-style cumulative revenue line.
    SUM(revenue) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS revenue_cumulative
FROM kpis
WINDOW w AS (ORDER BY month)
ORDER BY month;
