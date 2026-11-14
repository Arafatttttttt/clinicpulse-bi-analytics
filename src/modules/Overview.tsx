import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext';
import { useSql } from '../lib/useSql';
import { Q } from '../lib/sql';
import { Card, Delta, ErrorBox, LegendDot, Skeleton } from '../components/ui';
import { ChartTooltip, type TipProps } from '../components/ChartTooltip';
import { fmtDay, fmtDelta, fmtMoney, fmtMonth, fmtNum, fmtPct, fmtPp } from '../lib/format';
import { seriesColor } from '../lib/colors';

interface KpiRow {
  month: string;
  revenue: number;
  active_patients: number;
  completed_visits: number;
  avg_check: number;
  arpu: number;
  no_show_rate: number;
  contribution: number;
  net_margin: number;
  revenue_mom: number | null;
  active_patients_mom: number | null;
  avg_check_mom: number | null;
  arpu_mom: number | null;
  no_show_rate_mom_pp: number | null;
  net_margin_mom_pp: number | null;
}
interface DailyRow {
  day: string;
  weekday: string;
  is_weekend: boolean;
  visits: number;
  visits_7d_avg: number;
}
interface UnitRow {
  department_name: string;
  completed_visits: number;
  revenue: number;
  revenue_share: number;
  avg_check: number;
  cost_per_visit: number;
  commission_per_visit: number;
  contribution_per_visit: number;
  margin_pct: number;
  no_show_rate: number;
  lost_revenue_no_show: number;
}
interface NoShowRow {
  month: string;
  department_name: string;
  no_show_rate: number | null;
}
interface AnomalyRow {
  metric: string;
  segment_type: 'Department' | 'Branch';
  segment: string;
  detected_month: string;
  value: number;
  baseline: number;
  delta_pp: number;
  z_score: number | null;
  volume: number;
  est_revenue_at_risk: number;
}

const AXIS = { tickLine: false, axisLine: false, fontSize: 11 } as const;

export default function Overview() {
  const { vars } = useApp();
  const kpi = useSql<KpiRow>(Q.kpiMonthly, vars);

  return (
    <div className="space-y-4">
      <Insights />
      <KpiGrid state={kpi} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <RevenueChart state={kpi} className="xl:col-span-2" />
        <DailyVolume className="xl:col-span-3" />
        <NoShowChart className="xl:col-span-2" />
        <UnitEconomics className="xl:col-span-3" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Automated insights (05_anomaly_detection.sql)
// ─────────────────────────────────────────────────────────────────────────────
function Insights() {
  const { vars, dims, filters, setFilters } = useApp();
  const scanVars = useMemo(() => ({ ...vars, department_id: null, branch_id: null }), [vars]);
  const { data, error, loading, ms } = useSql<AnomalyRow>(Q.anomalies, scanVars);
  // Material (≥ 4 pp) AND extreme enough to survive ~200 simultaneous tests (z ≥ 4).
  const significant = (data ?? []).filter((r) => r.delta_pp >= 0.04 && (r.z_score ?? 0) >= 4).slice(0, 3);

  const drill = (r: AnomalyRow) => {
    const month = r.detected_month;
    const startIdx = Math.max(0, dims.months.indexOf(month) - 3);
    const next = { ...filters, startMonth: dims.months[startIdx], endMonth: dims.months[dims.months.length - 1] };
    if (r.segment_type === 'Department') {
      next.departmentId = dims.departments.find((d) => d.name === r.segment)?.id ?? null;
      next.branchId = null;
    } else {
      next.branchId = dims.branches.find((d) => d.name === r.segment)?.id ?? null;
      next.departmentId = null;
    }
    setFilters(next);
  };

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-accent" /> Automated insights
        </span>
      }
      subtitle="Every department & branch scanned for its worst month vs. its own trailing 3-month baseline · two-proportion z-test, z ≥ 4 and ≥ 4 pp"
      sqlName={Q.anomalies}
      loading={loading}
      ms={ms}
    >
      {error && <ErrorBox message={error} />}
      {!data && !error && (
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {data && significant.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-ink2">
          <CheckCircle2 className="h-4 w-4 text-good" /> No metric deteriorated materially (≥ 4 pp, z ≥ 4) vs. its baseline in this period.
        </div>
      )}
      {significant.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {significant.map((r) => (
            <div key={r.metric + r.segment} className="flex flex-col rounded-lg border border-line bg-subtle/40 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--critical)' }} />
                <div className="min-w-0 text-sm">
                  <span className="font-semibold">{r.segment}</span>
                  <span className="text-ink2">
                    {' '}
                    — {r.metric.toLowerCase()} jumped to <b className="tabular text-ink">{fmtPct(r.value)}</b>
                  </span>
                </div>
              </div>
              <p className="tabular mt-1.5 pl-6 text-xs leading-relaxed text-muted">
                {fmtMonth(r.detected_month)}: {fmtPp(r.delta_pp)} vs {fmtPct(r.baseline)} baseline
                {r.z_score !== null && Number.isFinite(r.z_score) ? ` (z = ${r.z_score.toFixed(1)})` : ''}
                {r.est_revenue_at_risk > 0 && <> · ≈{fmtMoney(r.est_revenue_at_risk, { compact: true })} revenue at risk / month</>}
              </p>
              <button
                type="button"
                onClick={() => drill(r)}
                className="mt-auto inline-flex items-center gap-1 self-start pl-6 pt-2 text-xs font-medium text-accent hover:underline"
              >
                Drill into {r.segment_type.toLowerCase()} <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI cards (01_kpi_monthly.sql)
// ─────────────────────────────────────────────────────────────────────────────
function KpiGrid({ state }: { state: ReturnType<typeof useSql<KpiRow>> }) {
  const rows = state.data;
  if (state.error) return <ErrorBox message={state.error} />;
  if (!rows) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[132px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <ErrorBox message="No data for the selected filters." />;
  const cur = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const vs = prev ? `vs ${fmtMonth(prev.month, true)}` : 'no prior month in range';

  const cards = [
    {
      label: 'Total Revenue',
      value: fmtMoney(cur.revenue, { compact: true }),
      delta: <Delta value={cur.revenue_mom} text={fmtDelta(cur.revenue_mom)} />,
      foot: `${fmtMoney(totalRevenue, { compact: true })} across ${rows.length} mo`,
      key: 'revenue' as const,
      good: 'up' as const,
    },
    {
      label: 'Active Patients',
      value: fmtNum(cur.active_patients),
      delta: <Delta value={cur.active_patients_mom} text={fmtDelta(cur.active_patients_mom)} />,
      foot: `${fmtNum(cur.completed_visits)} attended visits`,
      key: 'active_patients' as const,
      good: 'up' as const,
    },
    {
      label: 'Average Check',
      value: fmtMoney(cur.avg_check, { decimals: 2 }),
      delta: <Delta value={cur.avg_check_mom} text={fmtDelta(cur.avg_check_mom)} />,
      foot: `ARPU ${fmtMoney(cur.arpu, { decimals: 2 })} (${fmtDelta(cur.arpu_mom)})`,
      key: 'avg_check' as const,
      good: 'up' as const,
    },
    {
      label: 'No-Show Rate',
      value: fmtPct(cur.no_show_rate),
      delta: <Delta value={cur.no_show_rate_mom_pp} text={fmtPp(cur.no_show_rate_mom_pp)} goodWhen="down" />,
      foot: 'of non-cancelled appointments',
      key: 'no_show_rate' as const,
      good: 'down' as const,
    },
    {
      label: 'Net Margin',
      value: fmtPct(cur.net_margin),
      delta: <Delta value={cur.net_margin_mom_pp} text={fmtPp(cur.net_margin_mom_pp)} />,
      foot: `${fmtMoney(cur.contribution, { compact: true })} contribution`,
      key: 'net_margin' as const,
      good: 'up' as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-muted">{c.label}</span>
            <span className="shrink-0 text-[10px] text-muted">{fmtMonth(cur.month, true)}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-semibold tracking-tight">{c.value}</span>
            {c.delta}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">{vs}</div>
          <div className="-mx-1 mt-2 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                <defs>
                  <linearGradient id={`spark-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--s1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--s1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Area
                  type="monotone"
                  dataKey={c.key}
                  stroke="var(--s1)"
                  strokeWidth={1.75}
                  fill={`url(#spark-${c.key})`}
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 truncate text-[11px] text-ink2">{c.foot}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue vs contribution (01_kpi_monthly.sql)
// ─────────────────────────────────────────────────────────────────────────────
function RevenueChart({ state, className }: { state: ReturnType<typeof useSql<KpiRow>>; className?: string }) {
  const rows = state.data ?? [];
  return (
    <Card
      className={className}
      title="Revenue & contribution by month"
      subtitle="Net revenue of attended visits vs. what remains after direct costs and doctor commission"
      sqlName={Q.kpiMonthly}
      loading={state.loading}
      ms={state.ms}
      actions={
        <div className="hidden gap-3 sm:flex">
          <LegendDot color="var(--s1)" label="Revenue" />
          <LegendDot color="var(--s3)" label="Contribution" />
        </div>
      }
    >
      {!state.data ? (
        <Skeleton className="h-[260px]" />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={2} margin={{ top: 8, right: 4, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m: string) => fmtMonth(m, true).split(' ')[0]} {...AXIS} />
              <YAxis tickFormatter={(v: number) => fmtMoney(v, { compact: true })} width={52} {...AXIS} />
              <Tooltip
                cursor={{ fill: 'rgb(var(--subtle))' }}
                content={(p) => (
                  <ChartTooltip
                    {...(p as unknown as TipProps)}
                    formatLabel={(l) => fmtMonth(String(l))}
                    formatValue={(v) => fmtMoney(v)}
                    footer={(pl) => {
                      const r = pl[0]?.payload as unknown as KpiRow;
                      return <>Net margin {fmtPct(r.net_margin)} · MoM {fmtDelta(r.revenue_mom)}</>;
                    }}
                  />
                )}
              />
              <Bar dataKey="revenue" name="Revenue" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="contribution" name="Contribution" fill="var(--s3)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily volume with 7-day MA (02_daily_volume.sql)
// ─────────────────────────────────────────────────────────────────────────────
function DailyVolume({ className }: { className?: string }) {
  const { vars } = useApp();
  const { data, error, loading, ms } = useSql<DailyRow>(Q.dailyVolume, vars);
  const weekendShare = useMemo(() => {
    if (!data || data.length === 0) return null;
    const avg = (xs: DailyRow[]) => xs.reduce((a, r) => a + r.visits, 0) / Math.max(xs.length, 1);
    return avg(data.filter((d) => d.is_weekend)) / avg(data.filter((d) => !d.is_weekend));
  }, [data]);

  return (
    <Card
      className={className}
      title="Daily visit volume"
      subtitle={
        weekendShare !== null ? (
          <>
            Attended visits per day with 7-day moving average · weekends run at{' '}
            <b className="tabular text-ink2">{fmtPct(weekendShare, 0)}</b> of weekday volume
          </>
        ) : (
          'Attended visits per day with 7-day moving average'
        )
      }
      sqlName={Q.dailyVolume}
      loading={loading}
      ms={ms}
      actions={
        <div className="hidden gap-3 sm:flex">
          <LegendDot color="var(--s1-soft)" label="Daily" />
          <LegendDot color="var(--s1)" label="7-day avg" />
        </div>
      }
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[260px]" />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} barCategoryGap={0.5} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={40} {...AXIS} />
              <YAxis width={40} {...AXIS} />
              <Tooltip
                cursor={{ stroke: 'var(--chart-axis)' }}
                content={(p) => (
                  <ChartTooltip
                    {...(p as unknown as TipProps)}
                    formatLabel={(l) => {
                      const r = data.find((d) => d.day === l);
                      return `${r?.weekday ?? ''}, ${fmtDay(String(l))}`;
                    }}
                    formatValue={(v) => fmtNum(v, 1)}
                  />
                )}
              />
              <Bar dataKey="visits" name="Visits" fill="var(--s1-soft)" isAnimationActive={false} />
              <Line
                dataKey="visits_7d_avg"
                name="7-day avg"
                stroke="var(--s1)"
                strokeWidth={2}
                dot={false}
                type="monotone"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// No-show rate by department (04_noshow_by_department.sql)
// ─────────────────────────────────────────────────────────────────────────────
function NoShowChart({ className }: { className?: string }) {
  const { vars, dims, filters } = useApp();
  const { data, error, loading, ms } = useSql<NoShowRow>(Q.noShowByDept, vars);
  const [hovered, setHovered] = useState<string | null>(null);
  const focused =
    hovered ?? (filters.departmentId !== null ? dims.departments.find((d) => d.id === filters.departmentId)?.name ?? null : null);

  const pivot = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string | null>>();
    for (const r of data ?? []) {
      if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month });
      byMonth.get(r.month)![r.department_name] = r.no_show_rate;
    }
    return [...byMonth.values()];
  }, [data]);

  return (
    <Card
      className={className}
      title="No-show rate by department"
      subtitle="Hover a department to isolate it · department filter is ignored here so peers stay comparable"
      sqlName={Q.noShowByDept}
      loading={loading}
      ms={ms}
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[260px]" />
      ) : (
        <>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pivot} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m: string) => fmtMonth(m, true).split(' ')[0]} {...AXIS} />
                <YAxis tickFormatter={(v: number) => fmtPct(v, 0)} width={44} {...AXIS} />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-axis)' }}
                  content={(p) => (
                    <ChartTooltip
                      {...(p as unknown as TipProps)}
                      sort
                      formatLabel={(l) => fmtMonth(String(l))}
                      formatValue={(v) => fmtPct(v)}
                    />
                  )}
                />
                {dims.departments.map((d) => {
                  const dim = focused !== null && focused !== d.name;
                  return (
                    <Line
                      key={d.id}
                      dataKey={d.name}
                      name={d.name}
                      stroke={seriesColor(d.id)}
                      strokeWidth={focused === d.name ? 2.75 : 2}
                      strokeOpacity={dim ? 0.15 : 1}
                      dot={false}
                      activeDot={dim ? false : { r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
                      type="monotone"
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {dims.departments.map((d) => (
              <button
                key={d.id}
                type="button"
                onMouseEnter={() => setHovered(d.name)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(d.name)}
                onBlur={() => setHovered(null)}
                className={clsx('transition', focused !== null && focused !== d.name && 'opacity-40')}
              >
                <LegendDot color={seriesColor(d.id)} label={d.name} />
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit economics table (03_department_unit_economics.sql)
// ─────────────────────────────────────────────────────────────────────────────
function UnitEconomics({ className }: { className?: string }) {
  const { vars, dims } = useApp();
  const { data, error, loading, ms } = useSql<UnitRow>(Q.unitEconomics, vars);
  const idByName = new Map(dims.departments.map((d) => [d.name, d.id]));
  const total = useMemo(() => {
    if (!data) return null;
    const visits = data.reduce((a, r) => a + r.completed_visits, 0);
    const revenue = data.reduce((a, r) => a + r.revenue, 0);
    const contribution = data.reduce((a, r) => a + r.contribution_per_visit * r.completed_visits, 0);
    const lost = data.reduce((a, r) => a + r.lost_revenue_no_show, 0);
    return { visits, revenue, avgCheck: revenue / visits, cpv: contribution / visits, margin: contribution / revenue, lost };
  }, [data]);

  const th = 'px-2 py-2 text-right font-medium first:pl-0 first:text-left last:pr-0';
  const td = 'px-2 py-2 text-right first:pl-0 first:text-left last:pr-0';

  return (
    <Card
      className={className}
      title="Unit economics by department"
      subtitle="Per attended visit: check − direct cost − doctor commission = contribution"
      sqlName={Q.unitEconomics}
      loading={loading}
      ms={ms}
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[260px]" />
      ) : (
        <div className="scroll-thin -mx-1 overflow-x-auto px-1">
          <table className="tabular w-full min-w-[640px] text-xs">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className={th}>Department</th>
                <th className={th}>Revenue</th>
                <th className={clsx(th, 'w-24')}>Share</th>
                <th className={th}>Avg check</th>
                <th className={th}>Cost</th>
                <th className={th}>Comm.</th>
                <th className={th}>Contrib.</th>
                <th className={th}>Margin</th>
                <th className={th}>No-show</th>
                <th className={th}>Lost to no-shows</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.department_name} className="border-b border-line/60 last:border-0 hover:bg-subtle/50">
                  <td className={td}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium">
                      <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(idByName.get(r.department_name) ?? 1) }} />
                      {r.department_name}
                    </span>
                  </td>
                  <td className={td}>{fmtMoney(r.revenue, { compact: true })}</td>
                  <td className={td}>
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-subtle">
                        <div className="h-full rounded-full bg-[var(--s1)]" style={{ width: `${r.revenue_share * 100}%` }} />
                      </div>
                      <span className="w-9 text-ink2">{fmtPct(r.revenue_share, 0)}</span>
                    </div>
                  </td>
                  <td className={td}>{fmtMoney(r.avg_check, { decimals: 0 })}</td>
                  <td className={clsx(td, 'text-ink2')}>−{fmtMoney(r.cost_per_visit, { decimals: 0 })}</td>
                  <td className={clsx(td, 'text-ink2')}>−{fmtMoney(r.commission_per_visit, { decimals: 0 })}</td>
                  <td className={clsx(td, 'font-semibold')}>{fmtMoney(r.contribution_per_visit, { decimals: 0 })}</td>
                  <td className={td}>{fmtPct(r.margin_pct)}</td>
                  <td className={clsx(td, r.no_show_rate > 0.1 && 'font-semibold text-bad')}>{fmtPct(r.no_show_rate)}</td>
                  <td className={td}>{fmtMoney(r.lost_revenue_no_show, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot className="border-t border-line font-semibold">
                <tr>
                  <td className={td}>Network</td>
                  <td className={td}>{fmtMoney(total.revenue, { compact: true })}</td>
                  <td className={td} />
                  <td className={td}>{fmtMoney(total.avgCheck, { decimals: 0 })}</td>
                  <td className={td} />
                  <td className={td} />
                  <td className={td}>{fmtMoney(total.cpv, { decimals: 0 })}</td>
                  <td className={td}>{fmtPct(total.margin)}</td>
                  <td className={td} />
                  <td className={td}>{fmtMoney(total.lost, { compact: true })}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}
