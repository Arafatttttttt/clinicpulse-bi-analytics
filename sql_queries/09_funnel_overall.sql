-- =============================================================================
-- 09_funnel_overall.sql — New-patient journey funnel
-- -----------------------------------------------------------------------------
-- Powers: Conversion Funnel → funnel bars + step conversion / drop-off
--
-- Parameters: start_date, end_date (on the FIRST booking's creation date),
--             department_id, branch_id (department / branch of that booking)
--
-- Steps (strictly sequential — each step requires the previous one):
--   1. Booking Created   patient's very first booking
--   2. Confirmed         that booking was confirmed (call-center / SMS)
--   3. Attended          …and the patient showed up (status = completed)
--   4. Repeat Visit      …and came back for another completed visit ≤ 60 days later
--
-- Only NEW patients (registered inside the data window) are included, so the
-- first booking we see really is their first-ever booking.
--
-- Caveat: patients whose first visit is < 60 days before the end of the data
-- have had less time to repeat (right-censoring). Narrow the date range to
-- months with full follow-up when comparing repeat rates.
--
-- Techniques: ROW_NUMBER() de-duplication to "first event", correlated EXISTS
--             (decorrelated by DuckDB), FIRST_VALUE() and LAG() for
--             cumulative vs. step-over-step conversion.
-- =============================================================================
WITH ranked_bookings AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY booking_created_at, visit_id) AS booking_seq
    FROM fct_visits
),

journeys AS (
    SELECT
        fb.patient_id,
        fb.is_confirmed,
        fb.is_confirmed AND fb.is_completed AS is_attended,
        fb.is_confirmed AND fb.is_completed AND EXISTS (
            SELECT 1
            FROM fct_visits nx
            WHERE nx.patient_id = fb.patient_id
              AND nx.is_completed
              AND nx.scheduled_at >  fb.scheduled_at
              AND nx.scheduled_at <= fb.scheduled_at + INTERVAL 60 DAY
        ) AS is_repeat
    FROM ranked_bookings fb
    WHERE fb.booking_seq = 1
      AND fb.is_new_patient
      AND CAST(fb.booking_created_at AS DATE) BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR fb.department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR fb.branch_id     = getvariable('branch_id'))
),

steps AS (
    SELECT 1 AS step_order, 'Booking Created' AS step, COUNT(*)                            AS patients FROM journeys
    UNION ALL
    SELECT 2,               'Confirmed',               COUNT(*) FILTER (WHERE is_confirmed)            FROM journeys
    UNION ALL
    SELECT 3,               'Attended',                COUNT(*) FILTER (WHERE is_attended)             FROM journeys
    UNION ALL
    SELECT 4,               'Repeat Visit',            COUNT(*) FILTER (WHERE is_repeat)               FROM journeys
)

SELECT
    step_order,
    step,
    patients,
    patients::DOUBLE / FIRST_VALUE(patients) OVER (ORDER BY step_order)       AS conversion_from_start,
    patients::DOUBLE / LAG(patients)         OVER (ORDER BY step_order)       AS step_conversion,
    1 - patients::DOUBLE / LAG(patients)     OVER (ORDER BY step_order)       AS step_drop_off,
    LAG(patients) OVER (ORDER BY step_order) - patients                       AS patients_lost
FROM steps
ORDER BY step_order;
