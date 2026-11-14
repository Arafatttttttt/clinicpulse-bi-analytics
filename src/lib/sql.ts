/**
 * The SQL that powers every chart lives in /sql_queries as plain .sql files —
 * the exact same files a reviewer reads on GitHub. Vite inlines them as
 * strings at build time (`?raw`), so there is a single source of truth.
 */
const files = import.meta.glob('../../sql_queries/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export interface SqlFile {
  /** e.g. "06_cohort_retention.sql" */
  name: string;
  /** Human title parsed from the header comment. */
  title: string;
  /** "Powers: …" or "Library query" line, for context in the workspace. */
  usage: string;
  sql: string;
}

function parse(path: string, sql: string): SqlFile {
  const name = path.split('/').pop()!;
  const lines = sql.split(/\r?\n/);
  const headline = lines.find((l) => /^--\s*\d\d_/.test(l)) ?? name;
  const title = headline.split('—').slice(1).join('—').trim() || name;
  const usageLine = lines.find((l) => /^--\s*(Powers:|Library query)/.test(l)) ?? '';
  const usage = usageLine.replace(/^--\s*/, '').trim();
  return { name, title, usage, sql: sql.trim() + '\n' };
}

export const SQL_FILES: SqlFile[] = Object.entries(files)
  .map(([path, sql]) => parse(path, sql))
  .sort((a, b) => a.name.localeCompare(b.name));

const byName = new Map(SQL_FILES.map((f) => [f.name, f]));

export function sqlFile(name: string): SqlFile {
  const f = byName.get(name);
  if (!f) throw new Error(`Missing SQL file: ${name}`);
  return f;
}

export const SCHEMA_SQL = sqlFile('00_schema.sql').sql;

export const Q = {
  kpiMonthly: '01_kpi_monthly.sql',
  dailyVolume: '02_daily_volume.sql',
  unitEconomics: '03_department_unit_economics.sql',
  noShowByDept: '04_noshow_by_department.sql',
  anomalies: '05_anomaly_detection.sql',
  cohortRetention: '06_cohort_retention.sql',
  cohortLtv: '07_cohort_ltv.sql',
  timeToReturn: '08_time_to_return.sql',
  funnelOverall: '09_funnel_overall.sql',
  funnelBreakdown: '10_funnel_breakdown.sql',
  funnelTrend: '11_funnel_trend.sql',
} as const;
