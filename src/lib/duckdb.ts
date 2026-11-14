/**
 * DuckDB-Wasm bootstrap.
 *
 * 1. Picks the best Wasm bundle for the browser (EH = exception handling,
 *    falls back to MVP) — both shipped as hashed static assets via `?url`.
 * 2. Creates the schema by executing sql_queries/00_schema.sql verbatim.
 * 3. Generates the deterministic seed dataset in JS, serializes each table to
 *    CSV, registers it in DuckDB's virtual file system and bulk-loads it with
 *    COPY (≈60k rows in well under a second).
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { generateDataset, LOAD_ORDER, toCsv, type TableName } from '../data/generator';
import { SCHEMA_SQL } from './sql';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

export interface BootStep {
  label: string;
  done: boolean;
}
export interface BootStats {
  rowCounts: Record<TableName, number>;
  totalRows: number;
  bootMs: number;
  duckdbVersion: string;
}

let dbPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection; stats: BootStats }> | null = null;

export function bootDuckDB(onStep: (label: string) => void) {
  if (!dbPromise) dbPromise = boot(onStep);
  return dbPromise;
}

async function boot(onStep: (label: string) => void) {
  const t0 = performance.now();
  onStep('Loading DuckDB-Wasm engine');
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const conn = await db.connect();
  const versionRes = await conn.query('SELECT version() AS v');
  const duckdbVersion = String(versionRes.getChildAt(0)?.get(0) ?? '');

  onStep('Creating relational schema');
  await conn.query(SCHEMA_SQL);

  onStep('Generating 12 months of clinic data');
  // Yield to the browser so the progress label can paint before the CPU work.
  await new Promise((r) => setTimeout(r, 0));
  const data = generateDataset(42);

  onStep('Bulk-loading tables with COPY');
  const rowCounts = {} as Record<TableName, number>;
  for (const table of LOAD_ORDER) {
    const file = `${table}.csv`;
    await db.registerFileText(file, toCsv(table, data[table]));
    await conn.query(`COPY ${table} FROM '${file}' (FORMAT csv, HEADER true)`);
    await db.dropFile(file);
    rowCounts[table] = data[table].length;
  }

  onStep('Collecting statistics');
  await conn.query('ANALYZE');

  const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
  return { db, conn, stats: { rowCounts, totalRows, bootMs: performance.now() - t0, duckdbVersion } };
}
