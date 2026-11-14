/**
 * Query execution layer.
 *
 * - All queries share ONE DuckDB connection and run through a serial queue, so
 *   the session variables (`SET VARIABLE start_date = …`) a query depends on
 *   can never be swapped out by a concurrent query mid-flight.
 * - Arrow results are converted to plain JS rows with predictable types:
 *   integers / decimals → number, DATE → 'YYYY-MM-DD', TIMESTAMP → 'YYYY-MM-DD HH:MM:SS'.
 */
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { DataType, type Field, type Table, TimeUnit } from 'apache-arrow';

export type Row = Record<string, unknown>;
export interface ColumnInfo {
  name: string;
  type: string;
}
export interface QueryResult<T = Row> {
  columns: ColumnInfo[];
  rows: T[];
  ms: number;
}

/** Session variables consumed by the .sql files via getvariable('…'). */
export interface QueryVars {
  start_date: string;
  end_date: string;
  department_id: number | null;
  branch_id: number | null;
  channel: string | null;
}

let conn: AsyncDuckDBConnection | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastVarsKey = '';

export function setConnection(c: AsyncDuckDBConnection) {
  conn = c;
}

function literal(v: string | number | null, kind: 'date' | 'int' | 'text'): string {
  if (v === null) return 'NULL';
  if (kind === 'date') return `DATE '${String(v).replace(/'/g, "''")}'`;
  if (kind === 'int') return String(Math.trunc(Number(v)));
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function varsToSql(vars: QueryVars): string {
  return [
    `SET VARIABLE start_date    = ${literal(vars.start_date, 'date')};`,
    `SET VARIABLE end_date      = ${literal(vars.end_date, 'date')};`,
    `SET VARIABLE department_id = ${literal(vars.department_id, 'int')};`,
    `SET VARIABLE branch_id     = ${literal(vars.branch_id, 'int')};`,
    `SET VARIABLE channel       = ${literal(vars.channel, 'text')};`,
  ].join('\n');
}

/**
 * Runs SQL (optionally after setting session variables) on the serial queue.
 * `adhoc` marks user-written SQL from the workspace: it may SET VARIABLE
 * itself, so the cached variable state is invalidated afterwards and the next
 * dashboard query re-applies its own filters.
 */
export function runQuery<T = Row>(sql: string, vars?: QueryVars, opts: { adhoc?: boolean } = {}): Promise<QueryResult<T>> {
  const task = queue.then(async () => {
    if (!conn) throw new Error('DuckDB is not ready yet');
    if (vars) {
      const key = JSON.stringify(vars);
      if (key !== lastVarsKey || opts.adhoc) {
        await conn.query(varsToSql(vars));
        lastVarsKey = key;
      }
    }
    const t0 = performance.now();
    try {
      const table = await conn.query(sql);
      const ms = performance.now() - t0;
      return { ...arrowToRows<T>(table), ms };
    } finally {
      if (opts.adhoc) lastVarsKey = '';
    }
  });
  // Keep the queue alive even if this task fails.
  queue = task.catch(() => undefined);
  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrow → JS conversion
// ─────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function isoTs(ms: number): string {
  const d = new Date(ms);
  return `${isoDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Decimal128 values arrive as 4 little-endian 32-bit words (two's complement). */
function decimalToNumber(v: unknown, scale: number): number | null {
  if (v === null || v === undefined) return null;
  let big: bigint;
  if (typeof v === 'bigint') big = v;
  else if (typeof v === 'number') return v / 10 ** scale;
  else if (ArrayBuffer.isView(v)) {
    const view = v as Uint32Array;
    const words = new Uint32Array(view.buffer, view.byteOffset, Math.max(2, Math.floor(view.byteLength / 4)));
    big = 0n;
    for (let i = words.length - 1; i >= 0; i--) big = (big << 32n) | BigInt(words[i]);
    const bits = BigInt(words.length * 32);
    if (words[words.length - 1] & 0x80000000) big -= 1n << bits;
  } else {
    return Number(String(v)) / 10 ** scale;
  }
  // Split into integer + fractional parts to keep precision for large values.
  const div = 10n ** BigInt(scale);
  const intPart = big / div;
  const frac = big % div;
  return Number(intPart) + Number(frac) / Number(div);
}

function converterFor(field: Field): (v: unknown) => unknown {
  const t = field.type;
  if (DataType.isDecimal(t)) return (v) => decimalToNumber(v, t.scale);
  if (DataType.isInt(t)) return (v) => (typeof v === 'bigint' ? Number(v) : v);
  if (DataType.isFloat(t)) return (v) => (v === null ? null : Number(v));
  if (DataType.isDate(t)) {
    return (v) => (v === null || v === undefined ? null : isoDate(v instanceof Date ? v.getTime() : Number(v)));
  }
  if (DataType.isTimestamp(t)) {
    const divisor = t.unit === TimeUnit.SECOND ? 1e-3 : t.unit === TimeUnit.MILLISECOND ? 1 : t.unit === TimeUnit.MICROSECOND ? 1e3 : 1e6;
    return (v) => {
      if (v === null || v === undefined) return null;
      const ms = typeof v === 'bigint' ? Number(v) / divisor : v instanceof Date ? v.getTime() : Number(v);
      return isoTs(ms);
    };
  }
  if (DataType.isBool(t) || DataType.isUtf8(t)) return (v) => v ?? null;
  return (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return Number(v);
    const json = (v as { toJSON?: () => unknown }).toJSON?.() ?? v;
    return typeof json === 'object' ? JSON.stringify(json, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)) : json;
  };
}

function typeLabel(field: Field): string {
  const t = field.type;
  if (DataType.isDecimal(t)) return `DECIMAL(${t.precision},${t.scale})`;
  if (DataType.isInt(t)) return t.bitWidth === 64 ? 'BIGINT' : t.bitWidth === 32 ? 'INTEGER' : `INT${t.bitWidth}`;
  if (DataType.isFloat(t)) return 'DOUBLE';
  if (DataType.isDate(t)) return 'DATE';
  if (DataType.isTimestamp(t)) return 'TIMESTAMP';
  if (DataType.isBool(t)) return 'BOOLEAN';
  if (DataType.isUtf8(t)) return 'VARCHAR';
  return String(t);
}

export function arrowToRows<T = Row>(table: Table): { columns: ColumnInfo[]; rows: T[] } {
  const fields = table.schema.fields;
  const converters = fields.map(converterFor);
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const rows: T[] = new Array(table.numRows);
  for (let r = 0; r < table.numRows; r++) {
    const row: Row = {};
    for (let c = 0; c < fields.length; c++) {
      row[fields[c].name] = converters[c](vectors[c]?.get(r));
    }
    rows[r] = row as T;
  }
  return { columns: fields.map((f) => ({ name: f.name, type: typeLabel(f) })), rows };
}
