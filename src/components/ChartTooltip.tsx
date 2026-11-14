import type { ReactNode } from 'react';

export interface TooltipItem {
  name?: unknown;
  value?: unknown;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
}
export interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipItem>;
  label?: unknown;
}

/**
 * Shared tooltip body for every Recharts chart. Values are rendered in ink
 * (never in the series color); the colored swatch carries identity.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
  footer,
  sort = false,
}: TipProps & {
  formatLabel?: (l: unknown) => ReactNode;
  formatValue?: (v: number, item: TooltipItem) => ReactNode;
  footer?: (payload: ReadonlyArray<TooltipItem>) => ReactNode;
  sort?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = sort ? [...payload].sort((a, b) => Number(b.value) - Number(a.value)) : payload;
  return (
    <div className="pointer-events-none min-w-[160px] rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-1.5 font-semibold text-ink">{formatLabel ? formatLabel(label) : String(label ?? '')}</div>
      <div className="space-y-1">
        {items.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.stroke ?? p.fill }} />
              {String(p.name ?? p.dataKey ?? '')}
            </span>
            <span className="tabular font-medium text-ink">
              {formatValue ? formatValue(Number(p.value), p) : String(p.value)}
            </span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-muted">{footer(payload)}</div>}
    </div>
  );
}
