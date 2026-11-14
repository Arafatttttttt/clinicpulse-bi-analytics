import { useEffect, useState } from 'react';
import { Check, Database, Loader2 } from 'lucide-react';
import { bootDuckDB, type BootStats } from './lib/duckdb';
import { runQuery, setConnection } from './lib/query';
import { AppProvider, type Dimensions } from './state/AppContext';
import App from './App';

const STEPS = [
  'Loading DuckDB-Wasm engine',
  'Creating relational schema',
  'Generating 12 months of clinic data',
  'Bulk-loading tables with COPY',
  'Collecting statistics',
];

/** Boots DuckDB, loads data + dimension lists, then mounts the app. */
export default function Root() {
  const [current, setCurrent] = useState<string>(STEPS[0]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ stats: BootStats; dims: Dimensions } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { conn, stats } = await bootDuckDB((s) => !cancelled && setCurrent(s));
      setConnection(conn);
      // Dev-only console hook: `await __sql('SELECT 42')`
      if (import.meta.env.DEV) (window as unknown as { __sql: typeof runQuery }).__sql = runQuery;
      const [deps, branches, channels, months] = await Promise.all([
        runQuery<{ id: number; name: string }>('SELECT department_id AS id, department_name AS name FROM departments ORDER BY 1'),
        runQuery<{ id: number; name: string }>('SELECT branch_id AS id, branch_name AS name FROM branches ORDER BY 1'),
        runQuery<{ c: string }>('SELECT DISTINCT acquisition_channel AS c FROM patients ORDER BY 1'),
        runQuery<{ m: string }>('SELECT DISTINCT visit_month AS m FROM fct_visits ORDER BY 1'),
      ]);
      if (cancelled) return;
      setReady({
        stats,
        dims: {
          departments: deps.rows,
          branches: branches.rows,
          channels: channels.rows.map((r) => r.c),
          months: months.rows.map((r) => r.m),
        },
      });
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (ready) {
    return (
      <AppProvider dims={ready.dims} stats={ready.stats}>
        <App />
      </AppProvider>
    );
  }

  const idx = STEPS.indexOf(current);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Booting in-browser warehouse</div>
            <div className="text-xs text-muted">DuckDB-Wasm · no backend, all SQL runs locally</div>
          </div>
        </div>
        {error ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-bad/10 p-3 text-xs text-bad">{error}</pre>
        ) : (
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                {i < idx ? (
                  <Check className="h-4 w-4 text-good" />
                ) : i === idx ? (
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-line" />
                )}
                <span className={i <= idx ? 'text-ink' : 'text-muted'}>{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
