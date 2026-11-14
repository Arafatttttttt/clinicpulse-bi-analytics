import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext';
import { useSql } from '../lib/useSql';
import { Q, sqlFile } from '../lib/sql';
import { runQuery } from '../lib/query';
import { Card, ErrorBox, LegendDot, Segmented, Select, Skeleton } from '../components/ui';
import { ChartTooltip, type TipProps } from '../components/ChartTooltip';
import { fmtMoney, fmtMonth, fmtNum, fmtPct } from '../lib/format';
import { sequential, SERIES } from '../lib/colors';

interface RetentionRow {
  cohort_month: string | null;
  is_total: boolean;
  month_offset: number;
  cohort_size: number;
  active_patients: number;
  retention_rate: number;
}
interface LtvRow {
  cohort_month: string;
  month_offset: number;
  cohort_size: number;
  revenue_in_month: number;
  cumulative_ltv: number;
}
interface ReturnRow {
  week_bucket: number;
  label: string;
  returns: number;
  share: number;
  cumulative_share: number;
  median_days: number;
}

const OFFSETS = [0, 1, 2, 3, 4, 5, 6];
const AXIS = { tickLine: false, axisLine: false, fontSize: 11 } as const;

export default function Cohorts() {
  const { vars, dims } = useApp();
  const [metric, setMetric] = useState<'retention' | 'ltv'>('retention');
  const [channel, setChannel] = useState<string>('');
  const cohortVars = useMemo(() => ({ ...vars, channel: channel || null }), [vars, channel]);

  const retention = useSql<RetentionRow>(Q.cohortRetention, cohortVars);
  const ltv = useSql<LtvRow>(Q.cohortLtv, cohortVars);

  return (
    <div className="space-y-4">
      <CohortMatrix
        metric={metric}
        retention={retention}
        ltv={ltv}
        controls={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={[{ value: '', label: 'All channels' }, ...dims.channels.map((c) => ({ value: c, label: c }))]}
            />
            <Segmented
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'retention', label: 'Retention %' },
                { value: 'ltv', label: 'Cumulative LTV' },
              ]}
            />
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChannelCurves />
        <MonthOneByCohort retention={retention} />
        <TimeToReturn />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap matrix
// ─────────────────────────────────────────────────────────────────────────────
function CohortMatrix({
  metric,
  retention,
  ltv,
  controls,
}: {
  metric: 'retention' | 'ltv';
  retention: ReturnType<typeof useSql<RetentionRow>>;
  ltv: ReturnType<typeof useSql<LtvRow>>;
  controls: ReactNode;
}) {
  const { theme } = useApp();
  const [hover, setHover] = useState<string | null>(null);
  const state = metric === 'retention' ? retention : ltv;

  const model = useMemo(() => {
    if (metric === 'retention') {
      const rows = retention.data ?? [];
      const cohorts = new Map<string, { size: number; cells: Map<number, RetentionRow> }>();
      let total: Map<number, RetentionRow> | null = null;
      for (const r of rows) {
        if (r.is_total) {
          total ??= new Map();
          total.set(r.month_offset, r);
          continue;
        }
        const key = r.cohort_month!;
        if (!cohorts.has(key)) cohorts.set(key, { size: r.cohort_size, cells: new Map() });
        cohorts.get(key)!.cells.set(r.month_offset, r);
      }
      const max = Math.max(0.0001, ...rows.filter((r) => r.month_offset > 0).map((r) => r.retention_rate));
      return { kind: 'retention' as const, cohorts, total, max };
    }
    const rows = ltv.data ?? [];
    const cohorts = new Map<string, { size: number; cells: Map<number, LtvRow> }>();
    for (const r of rows) {
      if (!cohorts.has(r.cohort_month)) cohorts.set(r.cohort_month, { size: r.cohort_size, cells: new Map() });
      cohorts.get(r.cohort_month)!.cells.set(r.month_offset, r);
    }
    const max = Math.max(1, ...rows.map((r) => r.cumulative_ltv));
    return { kind: 'ltv' as const, cohorts, total: null, max };
  }, [metric, retention.data, ltv.data]);

  const cell = (value: number | undefined, isM0: boolean, label: string, readout: string) => {
    if (value === undefined) {
      return <td key={label} className="p-0.5" />;
    }
    const t = model.kind === 'retention' ? (isM0 ? 0 : value / model.max) : value / model.max;
    const { bg, fg } = isM0 && model.kind === 'retention' ? { bg: 'rgb(var(--subtle))', fg: 'rgb(var(--ink2))' } : sequential(t, theme);
    return (
      <td key={label} className="p-0.5">
        <div
          onMouseEnter={() => setHover(readout)}
          onMouseLeave={() => setHover(null)}
          className={clsx('tabular flex h-8 items-center justify-center rounded-[4px] text-[11px] font-medium transition hover:ring-2 hover:ring-ink/30')}
          style={{ background: bg, color: fg }}
        >
          {model.kind === 'retention' ? fmtPct(value, 1) : fmtMoney(value, { decimals: 0 })}
        </div>
      </td>
    );
  };

  return (
    <Card
      title={metric === 'retention' ? 'Monthly retention by acquisition cohort' : 'Cumulative revenue per patient (LTV) by cohort'}
      subtitle={
        metric === 'retention'
          ? 'Share of each cohort (first attended visit month) with an attended visit N months later · blank = not yet observable'
          : 'Running total of net revenue divided by cohort size — compare against acquisition cost for payback'
      }
      sqlName={metric === 'retention' ? Q.cohortRetention : Q.cohortLtv}
      loading={state.loading}
      ms={state.ms}
      actions={controls}
    >
      {state.error && <ErrorBox message={state.error} />}
      {!state.data ? (
        !state.error && <Skeleton className="h-[420px]" />
      ) : (
        <>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="pb-2 pr-3 text-left font-medium">Cohort</th>
                  <th className="pb-2 pr-3 text-right font-medium">Patients</th>
                  {OFFSETS.map((o) => (
                    <th key={o} className="pb-2 text-center font-medium">
                      {o === 0 ? 'Month 0' : `+${o}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...model.cohorts.entries()].map(([month, c]) => (
                  <tr key={month}>
                    <td className="whitespace-nowrap pr-3 font-medium">{fmtMonth(month)}</td>
                    <td className="tabular pr-3 text-right text-ink2">{fmtNum(c.size)}</td>
                    {OFFSETS.map((o) => {
                      const r = c.cells.get(o) as RetentionRow | LtvRow | undefined;
                      if (!r) return cell(undefined, o === 0, `${month}-${o}`, '');
                      if (model.kind === 'retention') {
                        const rr = r as RetentionRow;
                        return cell(
                          rr.retention_rate,
                          o === 0,
                          `${month}-${o}`,
                          `${fmtMonth(month)} cohort · month +${o}: ${fmtNum(rr.active_patients)} of ${fmtNum(rr.cohort_size)} patients returned (${fmtPct(rr.retention_rate)})`,
                        );
                      }
                      const lr = r as LtvRow;
                      return cell(
                        lr.cumulative_ltv,
                        o === 0,
                        `${month}-${o}`,
                        `${fmtMonth(month)} cohort · through month +${o}: ${fmtMoney(lr.cumulative_ltv, { decimals: 2 })} per patient (${fmtMoney(lr.revenue_in_month, { compact: true })} earned in month +${o})`,
                      );
                    })}
                  </tr>
                ))}
                {model.kind === 'retention' && model.total && (
                  <tr>
                    <td className="whitespace-nowrap border-t border-line pr-3 pt-1 font-semibold">Weighted avg</td>
                    <td className="tabular border-t border-line pr-3 pt-1 text-right text-ink2">
                      {fmtNum(model.total.get(0)?.cohort_size)}
                    </td>
                    {OFFSETS.map((o) => {
                      const r = model.total!.get(o);
                      return (
                        <td key={o} className="border-t border-line p-0.5 pt-1">
                          {r && (
                            <div
                              onMouseEnter={() =>
                                setHover(
                                  `All cohorts · month +${o}: ${fmtNum(r.active_patients)} of ${fmtNum(r.cohort_size)} observable patients (${fmtPct(r.retention_rate)})`,
                                )
                              }
                              onMouseLeave={() => setHover(null)}
                              className="tabular flex h-8 items-center justify-center rounded-[4px] border border-line text-[11px] font-semibold"
                            >
                              {fmtPct(r.retention_rate, 1)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className={clsx('tabular min-h-[1rem]', hover ? 'text-ink' : 'text-muted')}>
              {hover ?? 'Hover a cell for the underlying counts.'}
            </span>
            <div className="flex items-center gap-2 text-muted">
              <span>{model.kind === 'retention' ? '0%' : '$0'}</span>
              <div className="flex overflow-hidden rounded">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="h-2.5 w-4" style={{ background: sequential(i / 9, theme).bg }} />
                ))}
              </div>
              <span className="tabular">{model.kind === 'retention' ? fmtPct(model.max, 0) : fmtMoney(model.max, { decimals: 0 })}</span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention curve per acquisition channel — re-runs 06_cohort_retention.sql
// once per channel with a different `channel` session variable.
// ─────────────────────────────────────────────────────────────────────────────
function ChannelCurves() {
  const { vars, dims } = useApp();
  const [data, setData] = useState<Record<string, number | string>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const varsKey = JSON.stringify(vars);

  useEffect(() => {
    let cancelled = false;
    const sql = sqlFile(Q.cohortRetention).sql;
    Promise.all(
      dims.channels.map((c) =>
        runQuery<RetentionRow>(sql, { ...vars, channel: c }).then((r) => [c, r.rows.filter((x) => x.is_total)] as const),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const rows = OFFSETS.slice(1).map((o) => {
          const row: Record<string, number | string> = { offset: `+${o}` };
          for (const [c, rs] of results) {
            const hit = rs.find((x) => x.month_offset === o);
            if (hit) row[c] = hit.retention_rate;
          }
          return row;
        });
        setData(rows);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [varsKey, dims.channels]); // `vars` is captured via its serialized key

  return (
    <Card
      title="Retention curve by acquisition channel"
      subtitle="Weighted average across cohorts · same SQL, one run per channel"
      sqlName={Q.cohortRetention}
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[240px]" />
      ) : (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="offset" {...AXIS} />
                <YAxis tickFormatter={(v: number) => fmtPct(v, 0)} width={44} {...AXIS} />
                <Tooltip
                  cursor={{ stroke: 'var(--chart-axis)' }}
                  content={(p) => (
                    <ChartTooltip
                      {...(p as unknown as TipProps)}
                      sort
                      formatLabel={(l) => `Month ${String(l)}`}
                      formatValue={(v) => fmtPct(v)}
                    />
                  )}
                />
                {dims.channels.map((c, i) => {
                  const dim = hovered !== null && hovered !== c;
                  return (
                    <Line
                      key={c}
                      dataKey={c}
                      name={c}
                      stroke={SERIES[i]}
                      strokeWidth={hovered === c ? 2.75 : 2}
                      strokeOpacity={dim ? 0.15 : 1}
                      dot={{ r: 3, strokeWidth: 0, fill: SERIES[i], fillOpacity: dim ? 0.15 : 1 }}
                      activeDot={dim ? false : { r: 4.5, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {dims.channels.map((c, i) => (
              <button
                key={c}
                type="button"
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered(null)}
                className={clsx('transition', hovered !== null && hovered !== c && 'opacity-40')}
              >
                <LegendDot color={SERIES[i]} label={c} />
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Month +1 retention per cohort
// ─────────────────────────────────────────────────────────────────────────────
function MonthOneByCohort({ retention }: { retention: ReturnType<typeof useSql<RetentionRow>> }) {
  const rows = (retention.data ?? []).filter((r) => !r.is_total && r.month_offset === 1);
  const avg = (retention.data ?? []).find((r) => r.is_total && r.month_offset === 1)?.retention_rate ?? null;
  return (
    <Card
      title="Month +1 retention by cohort"
      subtitle="Early signal of cohort quality — dashed line is the weighted average"
      sqlName={Q.cohortRetention}
      loading={retention.loading}
      ms={retention.ms}
    >
      {!retention.data ? (
        <Skeleton className="h-[240px]" />
      ) : (
        <div className="h-[244px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="cohort_month" tickFormatter={(m: string) => fmtMonth(m, true).split(' ')[0]} {...AXIS} />
              <YAxis tickFormatter={(v: number) => fmtPct(v, 0)} width={44} {...AXIS} />
              <Tooltip
                cursor={{ fill: 'rgb(var(--subtle))' }}
                content={(p) => (
                  <ChartTooltip
                    {...(p as unknown as TipProps)}
                    formatLabel={(l) => `${fmtMonth(String(l))} cohort`}
                    formatValue={(v) => fmtPct(v)}
                    footer={(pl) => {
                      const r = pl[0]?.payload as unknown as RetentionRow;
                      return `${fmtNum(r.active_patients)} of ${fmtNum(r.cohort_size)} patients`;
                    }}
                  />
                )}
              />
              {avg !== null && <ReferenceLine y={avg} stroke="var(--chart-text)" strokeDasharray="4 4" />}
              <Bar dataKey="retention_rate" name="Month +1 retention" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Time to return (08_time_to_return.sql)
// ─────────────────────────────────────────────────────────────────────────────
function TimeToReturn() {
  const { vars } = useApp();
  const { data, error, loading, ms } = useSql<ReturnRow>(Q.timeToReturn, vars);
  const median = data?.[0]?.median_days ?? null;
  return (
    <Card
      title="Time to return"
      subtitle={
        median !== null ? (
          <>
            Days between consecutive attended visits (LEAD) · median <b className="tabular text-ink2">{fmtNum(median, 0)} days</b>
          </>
        ) : (
          'Days between consecutive attended visits (LEAD)'
        )
      }
      sqlName={Q.timeToReturn}
      loading={loading}
      ms={ms}
      actions={
        <div className="hidden gap-3 sm:flex">
          <LegendDot color="var(--s1)" label="Share" />
          <LegendDot color="var(--s2)" label="Cumulative" />
        </div>
      }
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[240px]" />
      ) : (
        <div className="h-[244px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" interval={1} {...AXIS} tickFormatter={(l: string) => l.replace(' wk', 'w')} />
              <YAxis tickFormatter={(v: number) => fmtPct(v, 0)} width={44} domain={[0, 1]} {...AXIS} />
              <Tooltip
                cursor={{ fill: 'rgb(var(--subtle))' }}
                content={(p) => (
                  <ChartTooltip
                    {...(p as unknown as TipProps)}
                    formatLabel={(l) => `Returned after ${String(l)}`}
                    formatValue={(v) => fmtPct(v)}
                  />
                )}
              />
              <Bar dataKey="share" name="Share of returns" fill="var(--s1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="cumulative_share" name="Cumulative" stroke="var(--s2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
