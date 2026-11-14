import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import CodeMirror from '@uiw/react-codemirror';
import type { EditorView } from '@codemirror/view';
import { PostgreSQL, sql as sqlLang } from '@codemirror/lang-sql';
import { ChevronDown, ChevronRight, Download, FileCode2, KeyRound, Link2, Play, Table2, Eye, Variable } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { runQuery, varsToSql, type ColumnInfo, type Row } from '../lib/query';
import { SQL_FILES, sqlFile } from '../lib/sql';
import { Card, ErrorBox } from '../components/ui';
import { SchemaDiagram, type ColumnMeta, type ForeignKey } from '../components/SchemaDiagram';
import { DataTable } from '../components/DataTable';
import { fmtNum } from '../lib/format';

const WELCOME = `-- Welcome to the SQL Workspace — everything runs in DuckDB-Wasm, in your browser.
-- ⌘/Ctrl + Enter runs the editor (or just the selected text).
-- Dashboard filters are exposed as session variables: getvariable('start_date') …

-- Example: revenue leaderboard with a running share (window functions)
SELECT
    department_name,
    SUM(net_revenue)::DOUBLE                                          AS revenue,
    SUM(net_revenue) / SUM(SUM(net_revenue)) OVER ()                  AS share,
    SUM(SUM(net_revenue)) OVER (ORDER BY SUM(net_revenue) DESC)
        / SUM(SUM(net_revenue)) OVER ()                               AS cumulative_share
FROM fct_visits
WHERE visit_date BETWEEN getvariable('start_date') AND getvariable('end_date')
GROUP BY department_name
ORDER BY revenue DESC;
`;

const MAX_RENDER_ROWS = 500;

interface Result {
  columns: ColumnInfo[];
  rows: Row[];
  ms: number;
}

export default function Workspace() {
  const { vars, workspaceRequest, stats, theme } = useApp();
  const [code, setCode] = useState(WELCOME);
  const [title, setTitle] = useState('scratch.sql');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showEr, setShowEr] = useState(true);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  // ── Catalog metadata (live from DuckDB) ─────────────────────────────────────
  const [catalog, setCatalog] = useState<{ columns: ColumnMeta[]; pks: Set<string>; fks: ForeignKey[]; views: Set<string> } | null>(null);
  useEffect(() => {
    (async () => {
      const cols = await runQuery<ColumnMeta>(
        `SELECT table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'main'
         ORDER BY table_name, ordinal_position`,
      );
      const views = await runQuery<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'VIEW'`,
      );
      const cons = await runQuery<{ table_name: string; constraint_type: string; cols: string; constraint_text: string }>(
        `SELECT table_name, constraint_type, array_to_string(constraint_column_names, ',') AS cols, constraint_text
         FROM duckdb_constraints()
         WHERE schema_name = 'main' AND constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`,
      );
      const pks = new Set<string>();
      const fks: ForeignKey[] = [];
      for (const c of cons.rows) {
        if (c.constraint_type === 'PRIMARY KEY') c.cols.split(',').forEach((col) => pks.add(`${c.table_name}.${col}`));
        else {
          const m = /REFERENCES\s+"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/i.exec(c.constraint_text);
          if (m) fks.push({ table: c.table_name, column: c.cols, refTable: m[1], refColumn: m[2] });
        }
      }
      setCatalog({ columns: cols.rows, pks, fks, views: new Set(views.rows.map((v) => v.table_name)) });
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const tables = useMemo(() => {
    const m = new Map<string, ColumnMeta[]>();
    for (const c of catalog?.columns ?? []) {
      if (!m.has(c.table_name)) m.set(c.table_name, []);
      m.get(c.table_name)!.push(c);
    }
    return m;
  }, [catalog]);

  const extensions = useMemo(() => {
    const schema: Record<string, string[]> = {};
    tables.forEach((cols, t) => (schema[t] = cols.map((c) => c.column_name)));
    return [sqlLang({ dialect: PostgreSQL, schema, upperCaseKeywords: true })];
  }, [tables]);

  // ── Execution ───────────────────────────────────────────────────────────────
  const execute = useCallback(
    async (sqlText?: string) => {
      let text = sqlText ?? codeRef.current;
      const view = viewRef.current;
      if (!sqlText && view) {
        const sel = view.state.selection.main;
        if (!sel.empty) text = view.state.sliceDoc(sel.from, sel.to);
      }
      if (!text.trim()) return;
      setRunning(true);
      setError(null);
      try {
        const r = await runQuery(text, vars, { adhoc: true });
        setResult(r);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [vars],
  );

  // Requests coming from "SQL" buttons on dashboard cards: collapse the
  // diagram and bring the editor into view with the query already running.
  const editorRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!workspaceRequest) return;
    setCode(workspaceRequest.sql);
    setTitle(workspaceRequest.title);
    setShowEr(false);
    if (workspaceRequest.run) void execute(workspaceRequest.sql);
    // Wait for the diagram collapse to commit before measuring.
    const t = window.setTimeout(() => {
      const el = editorRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 130, behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(t);
    // Only react to new requests (nonce), not to `execute` identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRequest?.nonce]);

  const loadFile = (name: string, run = true) => {
    const f = sqlFile(name);
    setCode(f.sql);
    setTitle(f.name);
    if (run) void execute(f.sql);
  };

  const selectTable = (table: string) => {
    const q = `SELECT *\nFROM ${table}\nLIMIT 100;\n`;
    setCode(q);
    setTitle(`${table}.sql`);
    void execute(q);
  };

  const insertAtCursor = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } });
    view.focus();
  };

  const exportCsv = () => {
    if (!result) return;
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [result.columns.map((c) => esc(c.name)).join(','), ...result.rows.map((r) => result.columns.map((c) => esc(r[c.name])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/\.sql$/, '') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const library = SQL_FILES.filter((f) => f.name !== '00_schema.sql');

  return (
    <div className="space-y-4">
      {/* ER diagram */}
      <Card
        title="Entity-relationship schema"
        subtitle="Read live from DuckDB's catalog (information_schema, duckdb_constraints) · hover to trace relationships, click a table to query it"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadFile('00_schema.sql', false)}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-subtle/60 px-1.5 py-0.5 font-mono text-[11px] text-ink2 transition hover:text-accent"
            >
              <FileCode2 className="h-3 w-3" /> DDL
            </button>
            <button type="button" onClick={() => setShowEr((s) => !s)} className="text-muted hover:text-ink" aria-label="Toggle diagram">
              {showEr ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        }
      >
        {showEr && catalog && (
          <>
            <SchemaDiagram
              columns={catalog.columns}
              pks={catalog.pks}
              fks={catalog.fks}
              rowCounts={stats.rowCounts}
              onSelectTable={selectTable}
            />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              <span>
                <b style={{ color: 'var(--s4)' }}>PK</b> primary key
              </span>
              <span>
                <b className="text-accent">FK</b> foreign key · ○ many side, │ one side
              </span>
              <span>
                Semantic layer: <code className="font-mono text-ink2">fct_visits</code> view joins all dimensions & defines revenue / margin
              </span>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Sidebar: library + schema tree + variables (below the editor on small screens) */}
        <div className="order-2 space-y-4 lg:order-1">
          <Card title="Query library" subtitle="/sql_queries — the files powering every chart" bodyClassName="px-2 sm:px-2 pb-2">
            <ul className="scroll-thin max-h-[320px] space-y-0.5 overflow-y-auto">
              {library.map((f) => (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => loadFile(f.name)}
                    className={clsx(
                      'w-full rounded-md px-2 py-1.5 text-left transition hover:bg-subtle',
                      title === f.name && 'bg-subtle',
                    )}
                  >
                    <div className="truncate font-mono text-[11px] text-ink">{f.name}</div>
                    <div className="truncate text-[11px] text-muted">{f.title}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Schema explorer" subtitle="Click a column to insert it" bodyClassName="px-2 sm:px-2 pb-2">
            <div className="scroll-thin max-h-[360px] overflow-y-auto">
              {[...tables.entries()].map(([t, cols]) => (
                <SchemaNode
                  key={t}
                  table={t}
                  isView={catalog?.views.has(t) ?? false}
                  columns={cols}
                  pks={catalog?.pks}
                  fks={catalog?.fks ?? []}
                  rows={stats.rowCounts[t as keyof typeof stats.rowCounts]}
                  onInsert={insertAtCursor}
                  onPreview={() => selectTable(t)}
                />
              ))}
            </div>
          </Card>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                <Variable className="h-3.5 w-3.5 text-muted" /> Session variables
              </span>
            }
            subtitle="Synced from dashboard filters before each run"
          >
            <pre className="scroll-thin overflow-x-auto rounded-md bg-subtle/60 p-2 font-mono text-[10.5px] leading-relaxed text-ink2">
              {varsToSql(vars)}
            </pre>
          </Card>
        </div>

        {/* Editor + results */}
        <div className="order-1 min-w-0 space-y-4 lg:order-2">
          <section ref={editorRef} className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileCode2 className="h-4 w-4 shrink-0 text-muted" />
                <span className="truncate font-mono text-xs text-ink2">{title}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-muted sm:inline">Ctrl + Enter</span>
                <button
                  type="button"
                  onClick={() => void execute()}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-60"
                >
                  <Play className="h-3.5 w-3.5" fill="currentColor" />
                  {running ? 'Running…' : 'Run'}
                </button>
              </div>
            </div>
            <div
              className="h-[380px]"
              onKeyDownCapture={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void execute();
                }
              }}
            >
              <CodeMirror
                value={code}
                height="100%"
                theme={theme}
                extensions={extensions}
                onChange={setCode}
                onCreateEditor={(view) => {
                  viewRef.current = view;
                }}
                basicSetup={{ foldGutter: false, highlightActiveLineGutter: true }}
              />
            </div>
          </section>

          <ResultsPanel result={result} error={error} running={running} onExport={exportCsv} />
        </div>
      </div>
    </div>
  );
}

function SchemaNode({
  table,
  isView,
  columns,
  pks,
  fks,
  rows,
  onInsert,
  onPreview,
}: {
  table: string;
  isView: boolean;
  columns: ColumnMeta[];
  pks?: Set<string>;
  fks: ForeignKey[];
  rows?: number;
  onInsert: (s: string) => void;
  onPreview: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-subtle">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
          {isView ? <Eye className="h-3.5 w-3.5 text-[var(--s7)]" /> : <Table2 className="h-3.5 w-3.5 text-muted" />}
          <span className="truncate font-mono text-xs">{table}</span>
          <span className="tabular ml-auto text-[10px] text-muted">{isView ? 'view' : rows !== undefined ? fmtNum(rows) : ''}</span>
        </button>
        <button
          type="button"
          onClick={onPreview}
          className="rounded px-1 text-[10px] text-muted opacity-0 transition hover:text-accent group-hover:opacity-100"
          title={`SELECT * FROM ${table} LIMIT 100`}
        >
          <Play className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <ul className="mb-1 ml-5 border-l border-line pl-2">
          {columns.map((c) => {
            const key = `${table}.${c.column_name}`;
            const fk = fks.find((f) => f.table === table && f.column === c.column_name);
            return (
              <li key={c.column_name}>
                <button
                  type="button"
                  onClick={() => onInsert(c.column_name)}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-subtle"
                  title={fk ? `→ ${fk.refTable}.${fk.refColumn}` : c.data_type}
                >
                  {pks?.has(key) ? (
                    <KeyRound className="h-3 w-3 shrink-0" style={{ color: 'var(--s4)' }} />
                  ) : fk ? (
                    <Link2 className="h-3 w-3 shrink-0 text-accent" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="truncate font-mono text-[11px] text-ink">{c.column_name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{c.data_type.toLowerCase()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ResultsPanel({
  result,
  error,
  running,
  onExport,
}: {
  result: Result | null;
  error: string | null;
  running: boolean;
  onExport: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-semibold">Results</span>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          {result && (
            <>
              <span className="tabular">
                {fmtNum(result.rows.length)} row{result.rows.length === 1 ? '' : 's'} · {result.columns.length} cols ·{' '}
                {result.ms < 10 ? result.ms.toFixed(1) : Math.round(result.ms)} ms
              </span>
              <button type="button" onClick={onExport} className="inline-flex items-center gap-1 hover:text-ink">
                <Download className="h-3 w-3" /> CSV
              </button>
            </>
          )}
        </div>
      </div>
      <div className="p-3">
        {error && <ErrorBox message={error} />}
        {!error && !result && (
          <p className="py-8 text-center text-xs text-muted">{running ? 'Running query…' : 'Run a query to see results here.'}</p>
        )}
        {result && result.columns.length === 0 && <p className="py-6 text-center text-xs text-muted">Statement executed — no rows returned.</p>}
        {result && result.columns.length > 0 && (
          <>
            <DataTable columns={result.columns} rows={result.rows} maxRows={MAX_RENDER_ROWS} className="max-h-[440px]" dimmed={running} />
          </>
        )}
      </div>
    </section>
  );
}
