import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Code2, Loader2, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { sqlFile } from '../lib/sql';

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────
export function Card({
  title,
  subtitle,
  sqlName,
  actions,
  children,
  className,
  bodyClassName,
  loading,
  ms,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  sqlName?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  loading?: boolean;
  ms?: number | null;
}) {
  return (
    <section className={clsx('relative flex min-w-0 flex-col rounded-xl border border-line bg-panel shadow-card', className)}>
      {(title || actions || sqlName) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {actions}
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-label="Loading" />}
            {sqlName && <SqlButton name={sqlName} ms={ms} />}
          </div>
        </header>
      )}
      <div className={clsx('min-w-0 flex-1 px-4 pb-4 pt-3 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Opens the exact .sql file behind a visual in the SQL Workspace. */
export function SqlButton({ name, ms }: { name: string; ms?: number | null }) {
  const { openInWorkspace } = useApp();
  return (
    <button
      type="button"
      onClick={() => {
        const f = sqlFile(name);
        openInWorkspace(f.sql, f.name);
      }}
      title={`Inspect & edit ${name} in the SQL Workspace`}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-subtle/60 px-1.5 py-0.5 font-mono text-[11px] text-ink2 transition hover:border-accent/50 hover:text-accent"
    >
      <Code2 className="h-3 w-3" />
      SQL
      {ms != null && <span className="text-muted">· {ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'sm',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'xs';
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md font-medium transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
            o.value === value ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={clsx('flex min-w-0 items-center gap-1.5 text-xs', className)}>
      <span className="shrink-0 text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 pr-7 text-xs font-medium text-ink outline-none transition hover:border-ink2/40 focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-md', className)} />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/5 p-3 font-mono text-xs text-bad">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <pre className="whitespace-pre-wrap break-words">{message}</pre>
    </div>
  );
}

/**
 * Delta badge. `goodWhen` decides the semantic color (a rising no-show rate is
 * bad); an arrow icon + sign always accompanies color, never color alone.
 */
export function Delta({
  value,
  text,
  goodWhen = 'up',
}: {
  value: number | null | undefined;
  text: string;
  goodWhen?: 'up' | 'down';
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-xs text-muted">—</span>;
  }
  const flat = Math.abs(value) < 0.0005;
  const good = flat ? null : (value > 0) === (goodWhen === 'up');
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        'tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold',
        good === null && 'bg-subtle text-muted',
        good === true && 'bg-good/10 text-good',
        good === false && 'bg-bad/10 text-bad',
      )}
    >
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

export function LegendDot({ color, label, dashed }: { color: string; label: ReactNode; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
      {dashed ? (
        <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: color }} />
      ) : (
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
