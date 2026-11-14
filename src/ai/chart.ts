/**
 * Turns a model's chart hint (or nothing) into a safe chart spec for an
 * arbitrary result set. Rules:
 *  - x must exist; y columns must exist and be numeric.
 *  - All plotted y columns share ONE unit (never a dual axis): rates with
 *    rates, money with money, counts with counts.
 *  - Single-row results and very long results are better read as a table.
 */
import type { ColumnInfo, Row } from '../lib/query';

export type ChartType = 'bar' | 'line';
export type Unit = 'percent' | 'money' | 'count';
export interface ChartSpec {
  type: ChartType;
  x: string;
  y: string[];
  unit: Unit;
}
export interface ChartHint {
  type?: string;
  x?: string;
  y?: string[];
}

const isNumericType = (t: string) => /INT|DOUBLE|DECIMAL|FLOAT|REAL|HUGEINT|NUMERIC/i.test(t);
const isTimeType = (t: string) => /DATE|TIMESTAMP/i.test(t);

export function unitOf(column: string): Unit {
  if (/(rate|pct|percent|share|ratio|growth|margin|conversion|retention|_pp$|delta)/i.test(column)) return 'percent';
  if (/(revenue|amount|cost|ltv|check|arpu|price|value|lost|paid|billed|commission|contribution|cash|usd|\$)/i.test(column)) return 'money';
  return 'count';
}

export function resolveChart(hint: ChartHint | null | undefined, columns: ColumnInfo[], rows: Row[]): ChartSpec | null {
  if (rows.length < 2 || rows.length > 120 || columns.length < 2) return null;
  if (hint?.type === 'none') return null;
  const byName = new Map(columns.map((c) => [c.name, c]));
  const numeric = columns.filter((c) => isNumericType(c.type) && !/_id$/i.test(c.name));

  let x = hint?.x && byName.has(hint.x) ? hint.x : undefined;
  if (!x) {
    const time = columns.find((c) => isTimeType(c.type));
    const label = columns.find((c) => !isNumericType(c.type));
    x = (time ?? label)?.name;
  }
  if (!x) return null;

  let y = (hint?.y ?? []).filter((n) => n !== x && byName.has(n) && isNumericType(byName.get(n)!.type));
  if (y.length === 0) y = numeric.filter((c) => c.name !== x).slice(0, 1).map((c) => c.name);
  if (y.length === 0) return null;

  // One axis, one unit: keep only series sharing the first series' unit.
  const unit = unitOf(y[0]);
  y = y.filter((n) => unitOf(n) === unit).slice(0, 4);

  const xType = byName.get(x)!.type;
  const type: ChartType =
    hint?.type === 'line' || hint?.type === 'bar' ? hint.type : isTimeType(xType) && rows.length > 3 ? 'line' : 'bar';
  return { type, x, y, unit };
}
