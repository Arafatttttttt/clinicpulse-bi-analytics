/**
 * Schema grounding for Text-to-SQL.
 *
 * The prompt context is built from DuckDB's LIVE catalog (information_schema,
 * duckdb_constraints) plus the real categorical values in the data, so it can
 * never drift from the actual schema. On top of that we add the semantic layer:
 * business metric definitions that match the dashboard's SQL exactly.
 */
import { runQuery } from '../lib/query';

let cached: Promise<string> | null = null;

export function getSchemaContext(): Promise<string> {
  if (!cached) cached = build().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

async function build(): Promise<string> {
  const [cols, cons, bounds, cats] = await Promise.all([
    runQuery<{ table_name: string; column_name: string; data_type: string; is_nullable: string; is_view: boolean }>(
      `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, t.table_type = 'VIEW' AS is_view
       FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema = 'main'
       ORDER BY t.table_type, c.table_name, c.ordinal_position`,
    ),
    runQuery<{ table_name: string; constraint_type: string; cols: string; constraint_text: string }>(
      `SELECT table_name, constraint_type, array_to_string(constraint_column_names, ',') AS cols, constraint_text
       FROM duckdb_constraints()
       WHERE schema_name = 'main' AND constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`,
    ),
    runQuery<{ min_d: string; max_d: string }>(`SELECT MIN(visit_date) AS min_d, MAX(visit_date) AS max_d FROM fct_visits`),
    runQuery<{ k: string; vals: string }>(
      `SELECT 'departments.department_name' AS k, string_agg(department_name, ' | ' ORDER BY department_id) AS vals FROM departments
       UNION ALL SELECT 'branches.branch_name', string_agg(branch_name, ' | ' ORDER BY branch_id) FROM branches
       UNION ALL SELECT 'patients.acquisition_channel', string_agg(DISTINCT acquisition_channel, ' | ') FROM patients
       UNION ALL SELECT 'patients.insurance_type', string_agg(DISTINCT insurance_type, ' | ') FROM patients
       UNION ALL SELECT 'doctors.seniority', string_agg(DISTINCT seniority, ' | ') FROM doctors
       UNION ALL SELECT 'visits.status', string_agg(DISTINCT status, ' | ') FROM visits
       UNION ALL SELECT 'visits.visit_type', string_agg(DISTINCT visit_type, ' | ') FROM visits
       UNION ALL SELECT 'payments.method', string_agg(DISTINCT method, ' | ') FROM payments
       UNION ALL SELECT 'payments.status', string_agg(DISTINCT status, ' | ') FROM payments`,
    ),
  ]);

  const pks = new Set<string>();
  const fkLines: string[] = [];
  const fkByCol = new Map<string, string>();
  for (const c of cons.rows) {
    if (c.constraint_type === 'PRIMARY KEY') {
      c.cols.split(',').forEach((col) => pks.add(`${c.table_name}.${col}`));
    } else {
      const m = /REFERENCES\s+"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/i.exec(c.constraint_text);
      if (m) {
        fkLines.push(`- ${c.table_name}.${c.cols} → ${m[1]}.${m[2]}`);
        fkByCol.set(`${c.table_name}.${c.cols}`, `${m[1]}.${m[2]}`);
      }
    }
  }

  const tables = new Map<string, { isView: boolean; cols: { def: string; tags: string }[] }>();
  for (const c of cols.rows) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, { isView: c.is_view, cols: [] });
    const key = `${c.table_name}.${c.column_name}`;
    const tags = [pks.has(key) ? 'PK' : '', fkByCol.has(key) ? `FK→${fkByCol.get(key)}` : '', c.is_nullable === 'YES' && !c.is_view ? 'nullable' : '']
      .filter(Boolean)
      .join(', ');
    tables.get(c.table_name)!.cols.push({ def: `  ${c.column_name} ${c.data_type}`, tags });
  }
  const tableBlocks = [...tables.entries()]
    .map(([t, v]) => {
      const lines = v.cols.map((c, i) => `${c.def}${i < v.cols.length - 1 ? ',' : ''}${c.tags ? `  -- ${c.tags}` : ''}`);
      return `${v.isView ? 'VIEW' : 'TABLE'} ${t} (\n${lines.join('\n')}\n)`;
    })
    .join('\n\n');

  const { min_d, max_d } = bounds.rows[0];
  const catLines = cats.rows.map((r) => `- ${r.k}: ${r.vals}`).join('\n');

  return `## Engine
DuckDB 1.4 (in-browser, DuckDB-Wasm). Use DuckDB SQL dialect.

## Data window and relative dates
Visits are scheduled between ${min_d} and ${max_d} inclusive. Treat ${max_d} as "today".
- "this month" / "last month" = October 2026 (the latest complete month)
- "last quarter" = Q3 2026 = 2026-07-01 .. 2026-09-30; the quarter before = Q2 2026 = 2026-04-01 .. 2026-06-30
- "last 12 months" / "this year" = the full data window
Always use literal dates; never use CURRENT_DATE, NOW() or getvariable().

## Schema (read from the live DuckDB catalog)
${tableBlocks}

## Foreign keys
${fkLines.join('\n')}

## fct_visits — semantic layer view (PREFER IT for analysis)
One row per BOOKING (any outcome), already joined to department, branch, doctor and patient.
- visit_date / visit_month: appointment date / first day of its month (DATE)
- is_confirmed: booking was confirmed (confirmed_at IS NOT NULL)
- is_completed: patient attended (status = 'completed');  is_no_show: status = 'no_show'
- net_revenue: billed_amount − discount for completed visits, else 0 (accrual revenue, by visit date)
- service_cost: direct cost of completed visits;  doctor_commission: net_revenue × doctor's commission_rate
- is_new_patient: patient registered inside the data window (their first visit is observable).
  Patients with is_new_patient = FALSE are left-censored legacy patients — EXCLUDE them from cohort / acquisition / LTV / first-visit analyses.

## Categorical values (exact spelling)
${catLines}

## Business metric definitions (use exactly these)
- Revenue = SUM(net_revenue) over fct_visits.
- Active patients = COUNT(DISTINCT patient_id) FILTER (WHERE is_completed).
- Average check = revenue / completed visits.  ARPU = revenue / active patients.
- No-show rate = no-shows / (completed + no-shows). Cancellations are excluded from the denominator.
- Confirmation rate = confirmed bookings / all bookings.  Booking-to-attendance conversion = completed / all bookings.
- Net margin = (revenue − service_cost − doctor_commission) / revenue.  Contribution = revenue − service_cost − doctor_commission.
- Revenue lost to no-shows = SUM(billed_amount − discount) FILTER (WHERE is_no_show).
- MoM growth = value / LAG(value) OVER (ORDER BY month) − 1.
- Cohort retention: cohort_month = month of a NEW patient's first completed visit. Month-N retention = share of the cohort with ≥ 1 completed visit in cohort_month + N months.
- Doctor / patient retention (60-day) = share of completed visits followed by the same patient's next completed visit within 60 days (LEAD over patient_id ORDER BY scheduled_at). Only score visits on or before 2026-09-01 so each has a full 60-day follow-up window.
- N-day LTV = net revenue from a new patient within N days of their first completed visit; only include patients whose first visit is ≥ N days before ${max_d}.
- Collections: cash = SUM(payments.paid_amount) (refunds are negative rows); insurance claims can be 'pending' (paid_amount 0, payment_date NULL) or 'denied'.

## SQL rules
1. Return exactly ONE read-only query: SELECT or WITH … SELECT. No DDL/DML, SET, PRAGMA, COPY, ATTACH, file functions, or multiple statements. No trailing semicolon.
2. Use only the tables, views and columns listed above. Never invent columns.
3. Compute ratios as fractions between 0 and 1 using ::DOUBLE, ROUND(…, 4); name them *_rate or *_share. Round money to 2 decimals.
4. Months: DATE_TRUNC('month', ts)::DATE or fct_visits.visit_month. Day differences: DATE_DIFF('day', a, b). Intervals: ts + INTERVAL 60 DAY.
5. Useful DuckDB features: FILTER (WHERE …), QUALIFY, GROUP BY ALL, ARG_MAX/ARG_MIN, window functions, GROUPING SETS.
6. Prefer readable CTEs. Use descriptive snake_case aliases (they become table headers and chart labels).
7. ORDER BY something meaningful and LIMIT to at most 200 rows. For "top N" questions, return exactly N rows.
8. Return human-readable labels (department_name, branch_name, full_name) instead of bare IDs.
9. For a time series, put the time column first and keep results in "wide" format (one column per series, ≤ 4 series).

## Example
Question: Monthly no-show rate for Riverside vs the rest of the network
SQL:
WITH m AS (
  SELECT visit_month,
         branch_name = 'Riverside' AS is_riverside,
         COUNT(*) FILTER (WHERE is_no_show)::DOUBLE
           / NULLIF(COUNT(*) FILTER (WHERE is_completed OR is_no_show), 0) AS no_show_rate
  FROM fct_visits
  GROUP BY ALL
)
SELECT visit_month,
       ROUND(MAX(no_show_rate) FILTER (WHERE is_riverside), 4)     AS riverside_no_show_rate,
       ROUND(MAX(no_show_rate) FILTER (WHERE NOT is_riverside), 4) AS rest_of_network_no_show_rate
FROM m
GROUP BY visit_month
ORDER BY visit_month`;
}
