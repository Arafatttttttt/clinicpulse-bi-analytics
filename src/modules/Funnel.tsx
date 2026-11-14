import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../state/AppContext';
import { useSql } from '../lib/useSql';
import { Q } from '../lib/sql';
import { Card, ErrorBox, LegendDot, Segmented, Skeleton } from '../components/ui';
import { ChartTooltip, type TipProps } from '../components/ChartTooltip';
import { fmtMonth, fmtNum, fmtPct, fmtPp } from '../lib/format';
import { divergingTint, seriesColor } from '../lib/colors';

interface StepRow {
  step_order: number;
  step: string;
  patients: number;
  conversion_from_start: number;
  step_conversion: number | null;
  step_drop_off: number | null;
  patients_lost: number | null;
}
interface BreakdownRow {
  dimension: 'total' | 'branch' | 'department';
  segment: string;
  created: number;
  confirmed: number;
  attended: number;
  repeated: number;
  confirm_rate: number;
  attend_rate: number;
  repeat_rate: number;
  end_to_end_rate: number;
  confirm_gap_pp: number;
  attend_gap_pp: number;
  repeat_gap_pp: number;
  bottleneck: 'Confirmation' | 'Attendance' | 'Repeat' | null;
}
interface TrendRow {
  month: string;
  dimension: 'branch' | 'department';
  segment: string;
  bookings: number;
  confirm_rate: number;
  attend_rate: number;
}

const AXIS = { tickLine: false, axisLine: false, fontSize: 11 } as const;
const STEP_HINT: Record<string, string> = {
  'Booking Created': "Patient's first-ever booking",
  Confirmed: 'Confirmed by call-center / SMS',
  Attended: 'Showed up for that appointment',
  'Repeat Visit': 'Came back within 60 days',
};

export default function Funnel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <FunnelBars className="xl:col-span-2" />
        <Breakdown className="xl:col-span-3" />
      </div>
      <Trend />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel bars (09_funnel_overall.sql)
// ─────────────────────────────────────────────────────────────────────────────
function FunnelBars({ className }: { className?: string }) {
  const { vars } = useApp();
  const { data, error, loading, ms } = useSql<StepRow>(Q.funnelOverall, vars);
  const worst = useMemo(() => {
    if (!data) return null;
    return data.slice(1).reduce<StepRow | null>((w, r) => (!w || (r.step_drop_off ?? 0) > (w.step_drop_off ?? 0) ? r : w), null);
  }, [data]);

  return (
    <Card
      className={className}
      title="New-patient journey"
      subtitle="Strictly sequential: each step requires the previous one"
      sqlName={Q.funnelOverall}
      loading={loading}
      ms={ms}
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[340px]" />
      ) : (
        <div className="space-y-1">
          {data.map((r, i) => (
            <div key={r.step}>
              {i > 0 && (
                <div className="tabular flex items-center gap-2 py-1.5 pl-3 text-[11px] text-muted">
                  <span className="h-4 border-l border-dashed border-line" />
                  <span>
                    <b className="text-ink2">{fmtPct(r.step_conversion)}</b> continue ·{' '}
                    <span className={clsx(worst?.step === r.step && 'font-semibold text-bad')}>
                      {fmtPct(r.step_drop_off)} drop off ({fmtNum(r.patients_lost)})
                    </span>
                    {worst?.step === r.step && <span className="ml-1 text-bad">← biggest leak</span>}
                  </span>
                </div>
              )}
              <div className="rounded-lg border border-line bg-subtle/40 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      <span className="mr-1.5 text-muted">{r.step_order}.</span>
                      {r.step}
                    </div>
                    <div className="text-[11px] text-muted">{STEP_HINT[r.step]}</div>
                  </div>
                  <div className="tabular text-right">
                    <div className="text-sm font-semibold">{fmtNum(r.patients)}</div>
                    <div className="text-[11px] text-muted">{fmtPct(r.conversion_from_start)} of start</div>
                  </div>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${r.conversion_from_start * 100}%`, background: 'var(--s1)' }}
                  />
                </div>
              </div>
            </div>
          ))}
          <p className="pt-2 text-[11px] leading-relaxed text-muted">
            Repeat visits are right-censored: patients acquired in the last ~60 days of the range have had less time to return.
          </p>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottleneck matrix (10_funnel_breakdown.sql)
// ─────────────────────────────────────────────────────────────────────────────
function Breakdown({ className }: { className?: string }) {
  const { vars, theme } = useApp();
  const { data, error, loading, ms } = useSql<BreakdownRow>(Q.funnelBreakdown, vars);
  const [dim, setDim] = useState<'department' | 'branch'>('department');
  const total = data?.find((r) => r.dimension === 'total');
  const rows = (data ?? []).filter((r) => r.dimension === dim);

  const rateCell = (rate: number, gap: number, flagged: boolean) => (
    <td className="px-1 py-1">
      <div
        className={clsx('tabular rounded-md px-2 py-1.5 text-right', flagged && 'ring-1 ring-bad/60')}
        style={{ background: divergingTint(gap, theme) }}
        title={`${fmtPp(gap)} vs network`}
      >
        <div className="font-medium">{fmtPct(rate)}</div>
        <div className={clsx('text-[10px]', gap < -0.005 ? 'text-bad' : 'text-muted')}>{fmtPp(gap)}</div>
      </div>
    </td>
  );

  return (
    <Card
      className={className}
      title="Bottlenecks by segment"
      subtitle="Step conversion vs. network benchmark (GROUPING SETS) · red = below network, outlined = segment's bottleneck"
      sqlName={Q.funnelBreakdown}
      loading={loading}
      ms={ms}
      actions={
        <Segmented
          value={dim}
          onChange={setDim}
          options={[
            { value: 'department', label: 'Department' },
            { value: 'branch', label: 'Branch' },
          ]}
        />
      }
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[340px]" />
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-2 text-left font-medium">{dim === 'department' ? 'Department' : 'Branch'}</th>
                <th className="px-2 py-2 text-right font-medium">Bookings</th>
                <th className="px-2 py-2 text-right font-medium">Confirm</th>
                <th className="px-2 py-2 text-right font-medium">Attend</th>
                <th className="px-2 py-2 text-right font-medium">Repeat</th>
                <th className="px-2 py-2 text-right font-medium">End-to-end</th>
                <th className="py-2 pl-2 text-left font-medium">Bottleneck</th>
              </tr>
            </thead>
            <tbody>
              {total && (
                <tr className="border-b border-line bg-subtle/40 font-medium">
                  <td className="py-2 pr-2">Network benchmark</td>
                  <td className="tabular px-2 text-right">{fmtNum(total.created)}</td>
                  <td className="tabular px-3 text-right">{fmtPct(total.confirm_rate)}</td>
                  <td className="tabular px-3 text-right">{fmtPct(total.attend_rate)}</td>
                  <td className="tabular px-3 text-right">{fmtPct(total.repeat_rate)}</td>
                  <td className="tabular px-2 text-right">{fmtPct(total.end_to_end_rate)}</td>
                  <td className="pl-2 text-muted">—</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.segment} className="border-b border-line/60 last:border-0">
                  <td className="whitespace-nowrap py-1 pr-2 font-medium">{r.segment}</td>
                  <td className="tabular px-2 text-right text-ink2">{fmtNum(r.created)}</td>
                  {rateCell(r.confirm_rate, r.confirm_gap_pp, r.bottleneck === 'Confirmation')}
                  {rateCell(r.attend_rate, r.attend_gap_pp, r.bottleneck === 'Attendance')}
                  {rateCell(r.repeat_rate, r.repeat_gap_pp, r.bottleneck === 'Repeat')}
                  <td className="tabular px-2 text-right font-semibold">{fmtPct(r.end_to_end_rate)}</td>
                  <td className="whitespace-nowrap pl-2">
                    {r.bottleneck ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-bad/10 px-1.5 py-0.5 text-[11px] font-medium text-bad">
                        <AlertTriangle className="h-3 w-3" /> {r.bottleneck}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">On par</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly conversion trend (11_funnel_trend.sql)
// ─────────────────────────────────────────────────────────────────────────────
function Trend() {
  const { vars, dims } = useApp();
  const { data, error, loading, ms } = useSql<TrendRow>(Q.funnelTrend, vars);
  const [dim, setDim] = useState<'branch' | 'department'>('branch');
  const [metric, setMetric] = useState<'confirm_rate' | 'attend_rate'>('confirm_rate');
  const [hovered, setHovered] = useState<string | null>(null);

  const entities = dim === 'branch' ? dims.branches : dims.departments;
  const pivot = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const r of data ?? []) {
      if (r.dimension !== dim) continue;
      if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month });
      byMonth.get(r.month)![r.segment] = r[metric];
    }
    return [...byMonth.values()];
  }, [data, dim, metric]);

  return (
    <Card
      title="Conversion trend"
      subtitle="All bookings, by appointment month — operational regressions show up the month they happen"
      sqlName={Q.funnelTrend}
      loading={loading}
      ms={ms}
      actions={
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'confirm_rate', label: 'Confirmation rate' },
              { value: 'attend_rate', label: 'Attendance rate' },
            ]}
          />
          <Segmented
            value={dim}
            onChange={setDim}
            options={[
              { value: 'branch', label: 'By branch' },
              { value: 'department', label: 'By department' },
            ]}
          />
        </div>
      }
    >
      {error && <ErrorBox message={error} />}
      {!data ? (
        !error && <Skeleton className="h-[280px]" />
      ) : (
        <>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pivot} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m: string) => fmtMonth(m, true)} {...AXIS} />
                <YAxis tickFormatter={(v: number) => fmtPct(v, 0)} width={44} domain={['auto', 1]} {...AXIS} />
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
                {entities.map((e) => {
                  const dimmed = hovered !== null && hovered !== e.name;
                  return (
                    <Line
                      key={e.id}
                      dataKey={e.name}
                      name={e.name}
                      stroke={seriesColor(e.id)}
                      strokeWidth={hovered === e.name ? 2.75 : 2}
                      strokeOpacity={dimmed ? 0.15 : 1}
                      dot={dim === 'branch' ? { r: 3, strokeWidth: 0, fill: seriesColor(e.id), fillOpacity: dimmed ? 0.15 : 1 } : false}
                      activeDot={dimmed ? false : { r: 4.5, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
                      type="monotone"
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {entities.map((e) => (
              <button
                key={e.id}
                type="button"
                onMouseEnter={() => setHovered(e.name)}
                onMouseLeave={() => setHovered(null)}
                className={clsx('transition', hovered !== null && hovered !== e.name && 'opacity-40')}
              >
                <LegendDot color={seriesColor(e.id)} label={e.name} />
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
