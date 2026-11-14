import clsx from 'clsx';
import type { ColumnInfo, Row } from '../lib/query';
import { fmtNum } from '../lib/format';

const isNumeric = (t: string) => /INT|DOUBLE|DECIMAL|FLOAT/.test(t);

function fmtCell(v: unknown, type: string) {
  if (v === null || v === undefined) return <span className="text-muted">NULL</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-good' : 'text-muted'}>{String(v)}</span>;
  if (typeof v === 'number') {
    if (/DOUBLE|FLOAT/.test(type)) return Number.isInteger(v) ? fmtNum(v) : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (/DECIMAL/.test(type)) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(v);
  }
  return String(v);
}

/** Typed result grid with a sticky header, shared by the SQL Workspace and the AI Analyst. */
export function DataTable({
  columns,
  rows,
  maxRows = 500,
  className,
  dimmed,
}: {
  columns: ColumnInfo[];
  rows: Row[];
  maxRows?: number;
  className?: string;
  dimmed?: boolean;
}) {
  return (
    <>
      <div className={clsx('scroll-thin overflow-auto rounded-lg border border-line', dimmed && 'opacity-60', className)}>
        <table className="tabular w-full text-xs">
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.name}
                  className={clsx('whitespace-nowrap border-b border-line px-3 py-1.5 font-medium', isNumeric(c.type) ? 'text-right' : 'text-left')}
                >
                  <div className="text-ink">{c.name}</div>
                  <div className="font-mono text-[9.5px] font-normal uppercase text-muted">{c.type}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, maxRows).map((r, i) => (
              <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-subtle/50">
                {columns.map((c) => (
                  <td key={c.name} className={clsx('whitespace-nowrap px-3 py-1', isNumeric(c.type) ? 'text-right' : 'text-left')}>
                    {fmtCell(r[c.name], c.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <p className="mt-2 text-[11px] text-muted">
          Showing first {fmtNum(maxRows)} of {fmtNum(rows.length)} rows.
        </p>
      )}
    </>
  );
}
