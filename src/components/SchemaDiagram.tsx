import { useState } from 'react';
import clsx from 'clsx';

export interface ColumnMeta {
  table_name: string;
  column_name: string;
  data_type: string;
}
export interface ForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

/**
 * Live ER diagram. Columns, primary keys and foreign keys come from DuckDB's
 * catalog (information_schema + duckdb_constraints()); only the box positions
 * are fixed so the layout stays readable.
 */
const W = 220;
const HEAD = 30;
const ROW = 18;
const POS: Record<string, { x: number; y: number }> = {
  branches: { x: 16, y: 60 },
  departments: { x: 16, y: 330 },
  doctors: { x: 296, y: 170 },
  visits: { x: 576, y: 60 },
  patients: { x: 868, y: 60 },
  payments: { x: 868, y: 290 },
};
// FKs that would cut through other boxes are routed around the diagram.
const ROUTES: Record<string, { lane: number }> = {
  'visits.branch_id': { lane: 32 },
  'patients.home_branch_id': { lane: 16 },
  'visits.department_id': { lane: 474 },
};

export function SchemaDiagram({
  columns,
  pks,
  fks,
  rowCounts,
  onSelectTable,
}: {
  columns: ColumnMeta[];
  pks: Set<string>; // "table.column"
  fks: ForeignKey[];
  rowCounts: Record<string, number>;
  onSelectTable: (table: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byTable = new Map<string, ColumnMeta[]>();
  for (const c of columns) {
    if (!POS[c.table_name]) continue;
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name)!.push(c);
  }
  const fkSet = new Set(fks.map((f) => `${f.table}.${f.column}`));
  const rowY = (table: string, column: string) => {
    const idx = (byTable.get(table) ?? []).findIndex((c) => c.column_name === column);
    return POS[table].y + HEAD + Math.max(idx, 0) * ROW + ROW / 2 + 4;
  };
  const related = new Set<string>();
  if (hover) {
    related.add(hover);
    for (const f of fks) {
      if (f.table === hover) related.add(f.refTable);
      if (f.refTable === hover) related.add(f.table);
    }
  }

  const edgePath = (f: ForeignKey): string | null => {
    const s = POS[f.table];
    const t = POS[f.refTable];
    if (!s || !t) return null;
    const sy = rowY(f.table, f.column);
    const ty = rowY(f.refTable, f.refColumn);
    const route = ROUTES[`${f.table}.${f.column}`];
    if (route) {
      const sx = s.x;
      const tx = t.x + W;
      const L = route.lane;
      return `M ${sx} ${sy} C ${sx - 30} ${sy}, ${sx - 30} ${L}, ${sx - 60} ${L} L ${tx + 40} ${L} C ${tx + 20} ${L}, ${tx + 20} ${ty}, ${tx} ${ty}`;
    }
    const leftward = t.x + W <= s.x;
    const sx = leftward ? s.x : s.x + W;
    const tx = leftward ? t.x + W : t.x;
    const dx = (tx - sx) / 2;
    return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  };
  const endpoint = (f: ForeignKey, end: 'fk' | 'pk') => {
    const s = POS[f.table];
    const t = POS[f.refTable];
    const routed = !!ROUTES[`${f.table}.${f.column}`];
    const leftward = routed || t.x + W <= s.x;
    if (end === 'fk') return { x: leftward ? s.x : s.x + W, y: rowY(f.table, f.column) };
    return { x: leftward ? t.x + W : t.x, y: rowY(f.refTable, f.refColumn) };
  };

  return (
    <div className="scroll-thin overflow-x-auto">
      <svg viewBox="0 0 1104 492" className="min-w-[780px]" role="img" aria-label="Entity-relationship diagram">
        {/* Edges first so boxes sit on top */}
        {fks.map((f) => {
          const d = edgePath(f);
          if (!d) return null;
          const active = hover !== null && (f.table === hover || f.refTable === hover);
          const faded = hover !== null && !active;
          const a = endpoint(f, 'fk');
          const b = endpoint(f, 'pk');
          const color = active ? 'rgb(var(--accent))' : 'var(--chart-axis)';
          return (
            <g key={`${f.table}.${f.column}`} opacity={faded ? 0.25 : 1}>
              <path d={d} fill="none" stroke={color} strokeWidth={active ? 2 : 1.5} />
              <circle cx={a.x} cy={a.y} r={3.5} fill="rgb(var(--panel))" stroke={color} strokeWidth={1.5} />
              <line x1={b.x + (b.x > a.x ? -6 : 6)} y1={b.y - 6} x2={b.x + (b.x > a.x ? -6 : 6)} y2={b.y + 6} stroke={color} strokeWidth={1.5} />
            </g>
          );
        })}

        {[...byTable.entries()].map(([table, cols]) => {
          const { x, y } = POS[table];
          const h = HEAD + cols.length * ROW + 8;
          const dim = hover !== null && !related.has(table);
          return (
            <g
              key={table}
              transform={`translate(${x} ${y})`}
              onMouseEnter={() => setHover(table)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectTable(table)}
              className={clsx('cursor-pointer transition-opacity')}
              opacity={dim ? 0.4 : 1}
            >
              <rect
                width={W}
                height={h}
                rx={8}
                fill="rgb(var(--panel))"
                stroke={hover === table ? 'rgb(var(--accent))' : 'rgb(var(--line))'}
                strokeWidth={hover === table ? 1.75 : 1}
              />
              <path d={`M0 8 a8 8 0 0 1 8 -8 h${W - 16} a8 8 0 0 1 8 8 v${HEAD - 8} h-${W} z`} fill="rgb(var(--subtle))" />
              <line x1={0} x2={W} y1={HEAD} y2={HEAD} stroke="rgb(var(--line))" />
              <text x={12} y={19} fontSize={12} fontWeight={600} fill="rgb(var(--ink))">
                {table}
              </text>
              <text x={W - 12} y={19} fontSize={10} textAnchor="end" fill="rgb(var(--muted))" className="tabular">
                {rowCounts[table]?.toLocaleString('en-US') ?? ''} rows
              </text>
              {cols.map((c, i) => {
                const key = `${table}.${c.column_name}`;
                const isPk = pks.has(key);
                const isFk = fkSet.has(key);
                const cy = HEAD + i * ROW + ROW / 2 + 8;
                return (
                  <g key={c.column_name}>
                    {(isPk || isFk) && (
                      <text x={12} y={cy} fontSize={8.5} fontWeight={700} fill={isPk ? 'var(--s4)' : 'rgb(var(--accent))'}>
                        {isPk ? 'PK' : 'FK'}
                      </text>
                    )}
                    <text x={30} y={cy} fontSize={11} fill="rgb(var(--ink))" fontWeight={isPk ? 600 : 400}>
                      {c.column_name}
                    </text>
                    <text x={W - 12} y={cy} fontSize={10} textAnchor="end" fill="rgb(var(--muted))" fontFamily="JetBrains Mono, monospace">
                      {c.data_type.replace('TIMESTAMP', 'TS').toLowerCase()}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
