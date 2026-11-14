-- =============================================================================
-- 13_collections_ar_aging.sql — Cash collection & accounts-receivable aging
-- -----------------------------------------------------------------------------
-- Library query (SQL Workspace). Parameters: end_date (the "as of" date)
--
-- Revenue on the dashboard is accrual-based (visit date). Cash arrives later,
-- especially from insurers. This query reconciles the two:
--   • collection rate by payment method      (cash collected / net billed)
--   • open insurance claims bucketed by age  (classic AR aging report)
--   • claim denial rate
--
-- Techniques: LEFT JOIN with aggregated child table (no fan-out), CASE
--             bucketing, ROLLUP for subtotals, FILTER aggregates.
-- =============================================================================
WITH settlements AS (
    -- Aggregate payments to visit grain first to avoid double-counting
    -- visits that have both a payment and a refund row.
    SELECT
        visit_id,
        ANY_VALUE(method)                                   AS method,
        SUM(paid_amount)                                    AS cash_collected,
        BOOL_OR(status = 'pending')                         AS is_pending,
        BOOL_OR(status = 'denied')                          AS is_denied,
        BOOL_OR(status = 'refunded')                        AS is_refunded
    FROM payments
    GROUP BY visit_id
),

billed AS (
    SELECT
        v.visit_id,
        v.visit_date,
        v.net_revenue,
        s.method,
        COALESCE(s.cash_collected, 0)                       AS cash_collected,
        COALESCE(s.is_pending, FALSE)                       AS is_pending,
        COALESCE(s.is_denied,  FALSE)                       AS is_denied,
        DATE_DIFF('day', v.visit_date, getvariable('end_date')) AS age_days
    FROM fct_visits v
    LEFT JOIN settlements s USING (visit_id)
    WHERE v.is_completed
      AND v.visit_date <= getvariable('end_date')
)

SELECT
    COALESCE(method, 'All methods')                                         AS method,
    COALESCE(
        CASE
            WHEN NOT is_pending THEN 'Settled'
            WHEN age_days <= 30  THEN 'Open 0–30 d'
            WHEN age_days <= 60  THEN 'Open 31–60 d'
            ELSE                      'Open 60+ d'
        END, 'Subtotal')                                                    AS ar_bucket,
    COUNT(*)                                                                AS visits,
    SUM(net_revenue)::DOUBLE                                                AS net_billed,
    SUM(cash_collected)::DOUBLE                                             AS cash_collected,
    SUM(cash_collected)::DOUBLE / NULLIF(SUM(net_revenue), 0)               AS collection_rate,
    AVG(is_denied::INTEGER)                                                 AS denial_rate
FROM billed
GROUP BY ROLLUP (method, CASE
            WHEN NOT is_pending THEN 'Settled'
            WHEN age_days <= 30  THEN 'Open 0–30 d'
            WHEN age_days <= 60  THEN 'Open 31–60 d'
            ELSE                      'Open 60+ d'
        END)
ORDER BY method NULLS LAST, ar_bucket;
