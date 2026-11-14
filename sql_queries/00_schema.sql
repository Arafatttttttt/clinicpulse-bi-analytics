-- =============================================================================
-- 00_schema.sql — ClinicPulse relational model (DuckDB dialect)
-- -----------------------------------------------------------------------------
-- Star-like normalized schema for a 3-branch, 8-department clinic network.
--
--   branches 1───*  doctors  *───1 departments
--      1                1               1
--      │                │               │
--      *                *               *
--   patients 1───*   visits  ───────────┘      (visits also FK → branches)
--                       1
--                       │
--                       *
--                   payments
--
-- Grain
--   visits   : one row per BOOKING (whatever the outcome). Funnel steps are
--              derived from booking_created_at → confirmed_at → status.
--   payments : one settlement row per completed visit, plus negative
--              `refunded` rows. Insurance claims may be `pending`/`denied`.
--
-- Money is stored as DECIMAL(10,2); never FLOAT for currency.
-- This exact file is executed by the web app at startup.
-- =============================================================================

CREATE TABLE branches (
    branch_id       INTEGER      PRIMARY KEY,
    branch_name     VARCHAR      NOT NULL UNIQUE,
    city_district   VARCHAR      NOT NULL,
    opened_date     DATE         NOT NULL
);

CREATE TABLE departments (
    department_id   INTEGER      PRIMARY KEY,
    department_name VARCHAR      NOT NULL UNIQUE,
    specialty_group VARCHAR      NOT NULL,          -- Primary Care | Specialist | Surgical
    base_price      DECIMAL(10,2) NOT NULL           -- list price of a standard consultation
);

CREATE TABLE doctors (
    doctor_id       INTEGER      PRIMARY KEY,
    full_name       VARCHAR      NOT NULL,
    department_id   INTEGER      NOT NULL REFERENCES departments (department_id),
    branch_id       INTEGER      NOT NULL REFERENCES branches (branch_id),
    seniority       VARCHAR      NOT NULL CHECK (seniority IN ('Junior', 'Mid', 'Senior')),
    hire_date       DATE         NOT NULL,
    commission_rate DECIMAL(4,2) NOT NULL CHECK (commission_rate BETWEEN 0 AND 1)  -- share of net revenue paid to the doctor
);

CREATE TABLE patients (
    patient_id          INTEGER  PRIMARY KEY,
    registered_at       DATE     NOT NULL,          -- date of first booking
    birth_year          INTEGER  NOT NULL,
    gender              VARCHAR  NOT NULL CHECK (gender IN ('F', 'M')),
    acquisition_channel VARCHAR  NOT NULL,          -- Organic | Referral | Google Ads | Instagram | Insurance Partner
    insurance_type      VARCHAR  NOT NULL,          -- Self-pay | Private Insurance | Corporate
    home_branch_id      INTEGER  NOT NULL REFERENCES branches (branch_id)
);

CREATE TABLE visits (
    visit_id            INTEGER   PRIMARY KEY,
    patient_id          INTEGER   NOT NULL REFERENCES patients (patient_id),
    doctor_id           INTEGER   NOT NULL REFERENCES doctors (doctor_id),
    department_id       INTEGER   NOT NULL REFERENCES departments (department_id),
    branch_id           INTEGER   NOT NULL REFERENCES branches (branch_id),
    booking_created_at  TIMESTAMP NOT NULL,         -- funnel step 1
    scheduled_at        TIMESTAMP NOT NULL,         -- appointment slot
    confirmed_at        TIMESTAMP,                  -- funnel step 2 (NULL = never confirmed)
    status              VARCHAR   NOT NULL CHECK (status IN ('completed', 'no_show', 'cancelled')),
    visit_type          VARCHAR   NOT NULL CHECK (visit_type IN ('initial', 'follow_up')),
    billed_amount       DECIMAL(10,2) NOT NULL,     -- quoted / invoiced price
    discount            DECIMAL(10,2) NOT NULL DEFAULT 0,
    service_cost        DECIMAL(10,2) NOT NULL DEFAULT 0  -- direct cost; 0 unless completed
);

CREATE TABLE payments (
    payment_id      INTEGER      PRIMARY KEY,
    visit_id        INTEGER      NOT NULL REFERENCES visits (visit_id),
    payment_date    DATE,                           -- NULL while an insurance claim is pending
    paid_amount     DECIMAL(10,2) NOT NULL,         -- negative for refunds
    method          VARCHAR      NOT NULL CHECK (method IN ('card', 'cash', 'insurance')),
    status          VARCHAR      NOT NULL CHECK (status IN ('paid', 'partial', 'pending', 'denied', 'refunded'))
);

-- -----------------------------------------------------------------------------
-- Semantic layer: one enriched view so every dashboard query shares the same
-- business definitions (revenue, margin, funnel flags) instead of re-deriving
-- them. Think of it as a dbt "fct_visits" model.
-- -----------------------------------------------------------------------------
CREATE VIEW fct_visits AS
SELECT
    v.visit_id,
    v.patient_id,
    v.doctor_id,
    v.department_id,
    d.department_name,
    v.branch_id,
    b.branch_name,
    p.acquisition_channel,
    p.registered_at                                           AS patient_registered_at,
    -- New = acquired inside the observation window, so their full history is
    -- visible. Legacy patients (registered earlier) are left-censored.
    p.registered_at >= (SELECT MIN(scheduled_at)::DATE FROM visits) AS is_new_patient,
    v.booking_created_at,
    v.scheduled_at,
    CAST(v.scheduled_at AS DATE)                              AS visit_date,
    DATE_TRUNC('month', v.scheduled_at)::DATE                 AS visit_month,
    v.confirmed_at IS NOT NULL                                AS is_confirmed,
    v.status = 'completed'                                    AS is_completed,
    v.status = 'no_show'                                      AS is_no_show,
    v.status,
    v.visit_type,
    v.billed_amount,
    v.discount,
    -- Net revenue is recognised on the visit date (accrual), completed visits only.
    CASE WHEN v.status = 'completed' THEN v.billed_amount - v.discount ELSE 0 END  AS net_revenue,
    CASE WHEN v.status = 'completed' THEN v.service_cost ELSE 0 END                AS service_cost,
    CASE WHEN v.status = 'completed'
         THEN (v.billed_amount - v.discount) * doc.commission_rate ELSE 0 END      AS doctor_commission
FROM visits      v
JOIN departments d   ON d.department_id = v.department_id
JOIN branches    b   ON b.branch_id     = v.branch_id
JOIN doctors     doc ON doc.doctor_id   = v.doctor_id
JOIN patients    p   ON p.patient_id    = v.patient_id;
