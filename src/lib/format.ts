const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtMoney(v: number | null | undefined, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const { compact = false, decimals } = opts;
  if (compact) {
    const a = Math.abs(v);
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  }
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals ?? (Math.abs(v) >= 1000 ? 0 : 2),
    minimumFractionDigits: decimals ?? 0,
  });
}

export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

/** Signed percentage-point delta: 0.034 → "+3.4 pp" */
export function fmtPp(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = (v * 100).toFixed(decimals);
  return `${v > 0 ? '+' : ''}${s} pp`;
}

/** Signed relative delta: 0.052 → "+5.2%" */
export function fmtDelta(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(decimals)}%`;
}

/** '2026-03-01' → 'Mar 2026' / 'Mar ’26' */
export function fmtMonth(iso: string | null | undefined, short = false): string {
  if (!iso) return '—';
  const [y, m] = iso.split('-').map(Number);
  return short ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}

/** '2026-03-14' → 'Mar 14' */
export function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function monthList(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let [y, m] = startIso.split('-').map(Number);
  const [ey, em] = endIso.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
