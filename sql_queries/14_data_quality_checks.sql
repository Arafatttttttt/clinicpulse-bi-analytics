-- =============================================================================
-- 14_data_quality_checks.sql — Automated data-quality assertions
-- -----------------------------------------------------------------------------
-- Library query (SQL Workspace). No parameters.
--
-- Every row is one test. `failed_rows = 0` means the assertion holds.
-- In a production pipeline these would run as dbt tests / Great Expectations
-- checks before dashboards refresh.
--
-- Techniques: anti-joins for orphan detection, temporal-logic assertions,
--             reconciliation between fact tables, UNION ALL test harness.
-- =============================================================================
SELECT 'visits.patient_id → patients (orphans)' AS test, COUNT(*) AS failed_rows
FROM visits v LEFT JOIN patients p USING (patient_id) WHERE p.patient_id IS NULL

UNION ALL
SELECT 'visits.doctor_id → doctors (orphans)', COUNT(*)
FROM visits v LEFT JOIN doctors d USING (doctor_id) WHERE d.doctor_id IS NULL

UNION ALL
SELECT 'payments.visit_id → visits (orphans)', COUNT(*)
FROM payments p ANTI JOIN visits v USING (visit_id)

UNION ALL
SELECT 'doctor works in the visit''s department & branch', COUNT(*)
FROM visits v JOIN doctors d USING (doctor_id)
WHERE d.department_id <> v.department_id OR d.branch_id <> v.branch_id

UNION ALL
SELECT 'booking created before appointment', COUNT(*)
FROM visits WHERE booking_created_at > scheduled_at

UNION ALL
SELECT 'confirmation between booking and appointment', COUNT(*)
FROM visits WHERE confirmed_at < booking_created_at OR confirmed_at > scheduled_at

UNION ALL
SELECT 'doctor hired before the visit', COUNT(*)
FROM visits v JOIN doctors d USING (doctor_id) WHERE d.hire_date > CAST(v.scheduled_at AS DATE)

UNION ALL
SELECT 'discount never exceeds billed amount', COUNT(*)
FROM visits WHERE discount > billed_amount OR discount < 0

UNION ALL
SELECT 'only completed visits are paid', COUNT(*)
FROM payments p JOIN visits v USING (visit_id) WHERE v.status <> 'completed'

UNION ALL
SELECT 'net cash per visit ≤ net billed', COUNT(*)
FROM (
    SELECT visit_id, SUM(paid_amount) AS cash FROM payments GROUP BY visit_id
) s JOIN visits v USING (visit_id)
WHERE s.cash > v.billed_amount - v.discount + 0.01

UNION ALL
SELECT 'every completed visit has a settlement row', COUNT(*)
FROM visits v ANTI JOIN payments p USING (visit_id) WHERE v.status = 'completed'

UNION ALL
SELECT 'pending claims have no payment date', COUNT(*)
FROM payments WHERE status = 'pending' AND payment_date IS NOT NULL

ORDER BY failed_rows DESC, test;
