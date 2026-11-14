# ClinicPulse — Self-Service BI & Product Analytics

A portfolio project showing end-to-end analytics work on a **3-branch, 8-department clinic network**: data modeling, a deterministic synthetic dataset with planted business problems, advanced SQL, and a self-service BI front-end.

All analytics run as **real SQL inside the browser** on [DuckDB-Wasm](https://duckdb.org/docs/api/wasm/overview). There is no backend: the warehouse is created, loaded (~70k rows), and queried client-side.

> **Every chart has a `SQL` button.** It opens the exact `.sql` file from [`/sql_queries`](sql_queries) behind that chart in the built-in editor, runs it, and lets you edit and re-run it.

---

## What the dashboard reveals

The data is simulated patient by patient with real mechanics, not random noise. The dashboard finds these issues without being told where to look:

| Finding | Where it shows up | SQL |
|---|---|---|
| **Riverside call-center understaffing (Sep 2026).** Booking confirmation rate falls from ~91% to ~64% (two-proportion z ≈ 16). | Automated insights, Funnel → Conversion trend | `05`, `11` |
| **Dermatology SMS-reminder outage (Aug 2026).** No-shows jump from ~11% to ~33% (z ≈ 8), costing ≈ $6K/month. | Automated insights, No-show by department, Funnel bottlenecks | `04`, `05`, `10` |
| **Low-quality summer Instagram campaign.** Jun/Jul 2026 cohorts retain ~30% worse in Month +1, and Instagram has the lowest retention curve of any channel. | Cohort heatmap, Retention by channel | `06` |
| **Ophthalmology repeat-visit gap.** Repeat rate is 9 pp below the network. | Funnel → Bottlenecks | `10` |
| Seasonality, weekly pattern, growth | Winter build-up, an August dip, weekends at ~35% of weekday volume, a 6% price increase in April | `01`, `02` |
| Receivables | Insurance claims settle 12–47 days after the visit; ~4% are denied | `13` |

## Modules

1. **Executive Overview.** KPI cards with MoM deltas (Revenue, Active Patients, Average Check / ARPU, No-Show Rate, Net Margin), revenue vs. contribution, daily volume with a 7-day moving average, no-show trends by department, a per-visit unit-economics table, and an **automated anomaly engine**.
2. **Cohort Retention.** A Month 0 → +6 retention heatmap (or cumulative LTV), retention curves per acquisition channel, Month +1 retention per cohort, and a time-to-return distribution.
3. **Conversion Funnel.** The new-patient journey *Booking Created → Confirmed → Attended → Repeat Visit*, a bottleneck matrix by department/branch benchmarked against the network, and a monthly conversion trend.
4. **SQL Workspace.** A live ER diagram read from DuckDB's catalog, a schema explorer, the query library, a CodeMirror editor with schema autocomplete (Ctrl/⌘ + Enter, runs the selection if one exists), typed result grid, and CSV export.

Global filters (date range, department, branch) are passed to SQL as **DuckDB session variables** (`SET VARIABLE` / `getvariable()`). Because of that, every `.sql` file runs unchanged in the app, in the DuckDB CLI, or in the workspace.

---

## Data model

```
branches 1──* doctors *──1 departments
   1             1              1
   *             *              *
patients 1──* visits ───────────┘   (visits also → branches)
                 1
                 *
             payments
```

| Table | Grain | Rows |
|---|---|---|
| `branches` | branch | 3 |
| `departments` | department (list price, specialty group) | 8 |
| `doctors` | doctor (seniority, hire date, commission rate) | 54 |
| `patients` | patient (channel, insurance, home branch) | ~22k |
| `visits` | **booking**, whatever the outcome (created → confirmed → completed / no-show / cancelled) | ~26k |
| `payments` | settlement per completed visit, plus refund rows; claims can be pending or denied | ~22k |

- The schema has primary keys, foreign keys, and `CHECK` constraints. Money is stored as `DECIMAL(10,2)`.
- `fct_visits` is a semantic-layer view (dbt-style). It holds the business definitions in one place: net revenue, direct cost, doctor commission, funnel flags, and `is_new_patient`.
- **Left-censoring is handled explicitly.** The simulation runs a 15-month burn-in, so the window opens on a mature patient base. Cohort and funnel queries include only patients acquired inside the window, so their first visit is actually observed.
- [`14_data_quality_checks.sql`](sql_queries/14_data_quality_checks.sql) asserts referential integrity, temporal logic, and payment reconciliation. All 12 checks pass with 0 failed rows.

## SQL library — techniques index

| File | Shows |
|---|---|
| [`00_schema.sql`](sql_queries/00_schema.sql) | DDL, constraints, semantic view |
| [`01_kpi_monthly.sql`](sql_queries/01_kpi_monthly.sql) | `FILTER` aggregates, named `WINDOW`, `LAG` MoM deltas (% vs pp), running total |
| [`02_daily_volume.sql`](sql_queries/02_daily_volume.sql) | `generate_series` date spine, gap-filling, 7-day moving average (`ROWS BETWEEN 6 PRECEDING`) |
| [`03_department_unit_economics.sql`](sql_queries/03_department_unit_economics.sql) | Per-visit P&L, share of total via `SUM() OVER ()`, `RANK` |
| [`04_noshow_by_department.sql`](sql_queries/04_noshow_by_department.sql) | Trailing baseline that excludes the current row (`3 PRECEDING AND 1 PRECEDING`) |
| [`05_anomaly_detection.sql`](sql_queries/05_anomaly_detection.sql) | Long-format `UNION ALL` series, volume-weighted baselines, **two-proportion z-test**, `QUALIFY` |
| [`06_cohort_retention.sql`](sql_queries/06_cohort_retention.sql) | `ARG_MIN` first touch, `DATEDIFF` offsets, observable-cell grid, **`GROUPING SETS`** weighted total |
| [`07_cohort_ltv.sql`](sql_queries/07_cohort_ltv.sql) | Cumulative LTV with partitioned running totals |
| [`08_time_to_return.sql`](sql_queries/08_time_to_return.sql) | `LEAD` inter-visit gaps, bucketing, CDF, `QUANTILE_CONT` |
| [`09_funnel_overall.sql`](sql_queries/09_funnel_overall.sql) | `ROW_NUMBER` first event, correlated `EXISTS`, `FIRST_VALUE` / `LAG` conversion |
| [`10_funnel_breakdown.sql`](sql_queries/10_funnel_breakdown.sql) | `GROUPING SETS` + `GROUPING()`, benchmark gaps, bottleneck classification |
| [`11_funnel_trend.sql`](sql_queries/11_funnel_trend.sql) | Multi-dimension monthly conversion, pp change |
| [`12_doctor_performance.sql`](sql_queries/12_doctor_performance.sql) | `DENSE_RANK`, `NTILE`, `PERCENT_RANK` within department |
| [`13_collections_ar_aging.sql`](sql_queries/13_collections_ar_aging.sql) | Accrual vs. cash reconciliation, AR aging buckets, `ROLLUP` |
| [`14_data_quality_checks.sql`](sql_queries/14_data_quality_checks.sql) | Anti-joins, temporal assertions, test harness |

To run a file outside the app, export the data and use the DuckDB CLI:

```bash
npm run data:export
```

```sql
-- in duckdb
.read sql_queries/00_schema.sql
COPY branches FROM 'data/branches.csv' (HEADER);   -- repeat in FK order: departments, doctors, patients, visits, payments
SET VARIABLE start_date = DATE '2025-11-01';
SET VARIABLE end_date   = DATE '2026-10-31';
.read sql_queries/06_cohort_retention.sql
```

---

## Tech stack

- **React 18 + TypeScript + Vite 5 + Tailwind CSS**: light and dark themes.
- **DuckDB-Wasm 1.32 (DuckDB 1.4)**: in-browser OLAP engine. The EH and MVP Wasm bundles ship as hashed static assets via `?url` imports.
- **Recharts 3**: charts. The categorical palette is CVD-validated and assigned by entity id, so a department keeps its color under any filter. Each axis carries one unit; there are no dual-axis charts.
- **CodeMirror 6**: SQL editor with schema-aware autocomplete.

```
src/
  data/generator.ts     deterministic seeded simulation (also runs in Node for CSV export)
  lib/duckdb.ts         engine bootstrap: schema → generate → COPY bulk load
  lib/query.ts          serialized query queue, session variables, Arrow → JS conversion (DECIMAL-safe)
  lib/sql.ts            imports /sql_queries/*.sql as raw strings (single source of truth)
  modules/              Overview, Cohorts, Funnel, Workspace
  components/           Card/KPI primitives, chart tooltip, live ER diagram
sql_queries/            the analytical SQL, readable on GitHub
scripts/export-data.ts  dumps the dataset to /data/*.csv
```

## Getting started

Requires Node 22.18+ (the CSV export script uses native TypeScript type-stripping; the app itself only needs Node 18+).

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run build` type-checks and emits a fully static `dist/`. `base: './'` keeps asset paths relative, so the folder can be deployed to GitHub Pages, Netlify, or any static host.
