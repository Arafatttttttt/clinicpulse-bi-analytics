-- =============================================================================
-- 03_department_unit_economics.sql — Per-visit P&L by department
-- -----------------------------------------------------------------------------
-- Powers: Executive Overview → "Unit Economics by Department" table
--
-- Parameters: start_date, end_date, department_id, branch_id
--
-- Unit economics of ONE attended visit:
--   avg_check            net revenue per completed visit
--   − cost_per_visit     consumables, room, equipment (service_cost)
--   − commission_per_visit  doctor's share of net revenue
--   = contribution_per_visit
--
-- Also quantifies the money left on the table: `lost_revenue_no_show` is the
-- quoted (billed − discount) value of appointments where the patient never came.
--
-- Techniques: share-of-total with SUM() OVER (), RANK(), FILTER aggregates.
-- =============================================================================
WITH filtered AS (
    SELECT *
    FROM fct_visits
    WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR branch_id     = getvariable('branch_id'))
),

by_department AS (
    SELECT
        department_name,
        COUNT(*) FILTER (WHERE is_completed)                                  AS completed_visits,
        COUNT(*) FILTER (WHERE is_no_show)                                    AS no_shows,
        SUM(net_revenue)::DOUBLE                                              AS revenue,
        SUM(service_cost)::DOUBLE                                             AS service_cost,
        SUM(doctor_commission)::DOUBLE                                        AS doctor_commission,
        SUM(billed_amount - discount) FILTER (WHERE is_no_show)::DOUBLE       AS lost_revenue_no_show
    FROM filtered
    GROUP BY department_name
)

SELECT
    RANK() OVER (ORDER BY revenue DESC)                                AS revenue_rank,
    department_name,
    completed_visits,
    revenue,
    revenue / SUM(revenue) OVER ()                                     AS revenue_share,
    revenue / NULLIF(completed_visits, 0)                              AS avg_check,
    service_cost / NULLIF(completed_visits, 0)                         AS cost_per_visit,
    doctor_commission / NULLIF(completed_visits, 0)                    AS commission_per_visit,
    (revenue - service_cost - doctor_commission)
        / NULLIF(completed_visits, 0)                                  AS contribution_per_visit,
    (revenue - service_cost - doctor_commission) / NULLIF(revenue, 0)  AS margin_pct,
    no_shows::DOUBLE / NULLIF(completed_visits + no_shows, 0)          AS no_show_rate,
    COALESCE(lost_revenue_no_show, 0)                                  AS lost_revenue_no_show
FROM by_department
ORDER BY revenue DESC;
