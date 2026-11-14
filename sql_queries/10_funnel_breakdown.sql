-- =============================================================================
-- 10_funnel_breakdown.sql — Funnel conversion by department AND branch in one
--                           pass, with bottleneck detection
-- -----------------------------------------------------------------------------
-- Powers: Conversion Funnel → "Bottlenecks by Segment" matrix
--
-- Parameters: start_date, end_date, department_id, branch_id
--
-- GROUPING SETS computes three aggregations over the same journeys in a single
-- scan: per department, per branch, and the network total. Each segment's step
-- rates are then compared with the network benchmark; the step with the most
-- negative gap (in percentage points) is flagged as that segment's bottleneck.
--
-- Techniques: GROUPING SETS + GROUPING(), conditional window aggregate as a
--             benchmark lookup, UNPIVOT-free arg-min via LEAST/CASE.
-- =============================================================================
WITH ranked_bookings AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY booking_created_at, visit_id) AS booking_seq
    FROM fct_visits
),

journeys AS (
    SELECT
        fb.department_name,
        fb.branch_name,
        fb.is_confirmed,
        fb.is_confirmed AND fb.is_completed AS is_attended,
        fb.is_confirmed AND fb.is_completed AND EXISTS (
            SELECT 1 FROM fct_visits nx
            WHERE nx.patient_id = fb.patient_id
              AND nx.is_completed
              AND nx.scheduled_at >  fb.scheduled_at
              AND nx.scheduled_at <= fb.scheduled_at + INTERVAL 60 DAY
        ) AS is_repeat
    FROM ranked_bookings fb
    WHERE fb.booking_seq = 1
      AND fb.is_new_patient                  -- first booking must be observable
      AND CAST(fb.booking_created_at AS DATE) BETWEEN getvariable('start_date') AND getvariable('end_date')
      AND (getvariable('department_id') IS NULL OR fb.department_id = getvariable('department_id'))
      AND (getvariable('branch_id')     IS NULL OR fb.branch_id     = getvariable('branch_id'))
),

segments AS (
    SELECT
        CASE
            WHEN GROUPING(department_name) = 0 THEN 'department'
            WHEN GROUPING(branch_name)     = 0 THEN 'branch'
            ELSE 'total'
        END                                                   AS dimension,
        COALESCE(department_name, branch_name, 'Network')     AS segment,
        COUNT(*)                                              AS created,
        COUNT(*) FILTER (WHERE is_confirmed)                  AS confirmed,
        COUNT(*) FILTER (WHERE is_attended)                   AS attended,
        COUNT(*) FILTER (WHERE is_repeat)                     AS repeated
    FROM journeys
    GROUP BY GROUPING SETS ((department_name), (branch_name), ())
),

rates AS (
    SELECT
        *,
        confirmed::DOUBLE / NULLIF(created, 0)   AS confirm_rate,
        attended::DOUBLE  / NULLIF(confirmed, 0) AS attend_rate,
        repeated::DOUBLE  / NULLIF(attended, 0)  AS repeat_rate,
        repeated::DOUBLE  / NULLIF(created, 0)   AS end_to_end_rate
    FROM segments
),

benchmarked AS (
    SELECT
        *,
        confirm_rate - MAX(confirm_rate) FILTER (WHERE dimension = 'total') OVER () AS confirm_gap_pp,
        attend_rate  - MAX(attend_rate)  FILTER (WHERE dimension = 'total') OVER () AS attend_gap_pp,
        repeat_rate  - MAX(repeat_rate)  FILTER (WHERE dimension = 'total') OVER () AS repeat_gap_pp
    FROM rates
)

SELECT
    dimension,
    segment,
    created,
    confirmed,
    attended,
    repeated,
    confirm_rate,
    attend_rate,
    repeat_rate,
    end_to_end_rate,
    confirm_gap_pp,
    attend_gap_pp,
    repeat_gap_pp,
    CASE
        WHEN dimension = 'total' THEN NULL
        WHEN LEAST(confirm_gap_pp, attend_gap_pp, repeat_gap_pp) > -0.03 THEN NULL   -- within 3pp of benchmark
        WHEN confirm_gap_pp <= LEAST(attend_gap_pp, repeat_gap_pp) THEN 'Confirmation'
        WHEN attend_gap_pp  <= repeat_gap_pp                       THEN 'Attendance'
        ELSE 'Repeat'
    END AS bottleneck
FROM benchmarked
ORDER BY CASE dimension WHEN 'total' THEN 0 WHEN 'branch' THEN 1 ELSE 2 END, created DESC;
