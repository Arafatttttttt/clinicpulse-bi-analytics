/**
 * Exports the deterministic seed dataset to /data/*.csv so it can be loaded
 * into any SQL engine (DuckDB CLI, Postgres, BigQuery…) outside the browser.
 *
 *   npm run data:export            # seed 42 (same data the web app uses)
 *   node scripts/export-data.ts 7  # custom seed
 *
 * Requires Node 22.18+ / 23.6+ (native TypeScript type-stripping).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDataset, LOAD_ORDER, toCsv } from '../src/data/generator.ts';

const seed = Number(process.argv[2] ?? 42);
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const data = generateDataset(seed);
let total = 0;
for (const table of LOAD_ORDER) {
  const rows = data[table];
  total += rows.length;
  writeFileSync(join(outDir, `${table}.csv`), toCsv(table, rows));
  console.log(`${table.padEnd(12)} ${String(rows.length).padStart(7)} rows`);
}
console.log(`${'TOTAL'.padEnd(12)} ${String(total).padStart(7)} rows  (seed=${seed}, ${(performance.now() - t0).toFixed(0)} ms) → ${outDir}`);
