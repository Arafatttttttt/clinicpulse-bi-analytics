import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../state/AppContext';
import { Card, ErrorBox, LegendDot, Segmented } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { ChartTooltip, type TipProps } from '../components/ChartTooltip';
import { DEFAULT_MODEL } from '../ai/gemini';
import { DEMO_QUESTIONS } from '../ai/demo';
import { runDemoTurn, runGeminiTurn, type Step, type Turn } from '../ai/pipeline';
import type { ChartSpec } from '../ai/chart';
import { SERIES } from '../lib/colors';
import { fmtMoney, fmtMonth, fmtNum, fmtPct } from '../lib/format';

// ─────────────────────────────────────────────────────────────────────────────
// BYOK settings — stored only in this browser's localStorage.
// ─────────────────────────────────────────────────────────────────────────────
const KEY_STORAGE = 'clinicpulse.gemini.apiKey';
const MODEL_STORAGE = 'clinicpulse.gemini.model';

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeStorage(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode) — the value lives for this session only */
  }
}

export default function AiAnalyst() {
  const [apiKey, setApiKey] = useState(() => readStorage(KEY_STORAGE));
  const [model, setModel] = useState(() => readStorage(MODEL_STORAGE) || DEFAULT_MODEL);
  const [mode, setMode] = useState<'gemini' | 'demo'>(() => (readStorage(KEY_STORAGE) ? 'gemini' : 'demo'));
  const [showSettings, setShowSettings] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = turns.some((t) => t.status === 'running');

  useEffect(() => () => abortRef.current?.abort(), []);

  const upsert = useCallback((t: Turn) => {
    setTurns((prev) => (prev.some((p) => p.id === t.id) ? prev.map((p) => (p.id === t.id ? t : p)) : [t, ...prev]));
  }, []);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setNotice(null);
    if (mode === 'demo') {
      const demo = DEMO_QUESTIONS.find((d) => d.question.toLowerCase() === q.toLowerCase());
      if (!demo) {
        setNotice('Demo mode answers the suggested questions below. Add a Gemini API key to ask anything.');
        return;
      }
      setQuestion('');
      await runDemoTurn(demo, upsert);
      return;
    }
    if (!apiKey) {
      setShowSettings(true);
      setNotice('Add a Gemini API key first, or switch to Demo mode.');
      return;
    }
    setQuestion('');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    // Turns are stored newest-first; the pipeline wants chronological history.
    const history = [...turns].reverse();
    await runGeminiTurn(q, { apiKey, model }, history, upsert, abortRef.current.signal);
  };

  return (
    <div className="space-y-4">
      {/* Header + mode */}
      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" /> AI Data Analyst Copilot
          </span>
        }
        subtitle="Ask a business question → schema-grounded SQL → executed on DuckDB in your browser → chart + executive summary"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setNotice(null);
                if (m === 'gemini' && !apiKey) setShowSettings(true);
              }}
              options={[
                { value: 'demo', label: 'Demo mode' },
                { value: 'gemini', label: 'Gemini' },
              ]}
            />
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className={clsx(
                'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition',
                apiKey ? 'border-good/40 text-good' : 'border-line text-ink2 hover:text-ink',
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {apiKey ? 'Key saved' : 'API key'}
            </button>
          </div>
        }
      >
        <ModeBanner mode={mode} model={model} hasKey={!!apiKey} />
        {showSettings && (
          <KeySettings
            apiKey={apiKey}
            model={model}
            onSave={(k, m) => {
              setApiKey(k);
              setModel(m || DEFAULT_MODEL);
              writeStorage(KEY_STORAGE, k);
              writeStorage(MODEL_STORAGE, m && m !== DEFAULT_MODEL ? m : '');
              if (k) setMode('gemini');
              setShowSettings(false);
              setNotice(null);
            }}
            onClear={() => {
              setApiKey('');
              writeStorage(KEY_STORAGE, '');
              setMode('demo');
            }}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Ask box */}
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-line bg-bg/60 p-2 focus-within:border-accent/60">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              rows={2}
              placeholder={
                mode === 'demo'
                  ? 'Pick a suggested question below (free-form questions need a Gemini key)…'
                  : 'e.g. Which doctors at Riverside have the highest no-show rate this quarter?'
              }
              className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent/90 disabled:opacity-40"
              aria-label="Ask"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </form>
        {notice && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink2">
            <AlertTriangle className="h-3.5 w-3.5 text-warn" /> {notice}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_QUESTIONS.map((d) => (
            <button
              key={d.question}
              type="button"
              disabled={busy}
              onClick={() => void ask(d.question)}
              className="rounded-full border border-line bg-subtle/50 px-3 py-1.5 text-left text-xs text-ink2 transition hover:border-accent/50 hover:text-ink disabled:opacity-50"
            >
              {d.question}
            </button>
          ))}
        </div>
      </Card>

      {turns.length === 0 && <EmptyState />}
      {turns.map((t) => (
        <TurnCard key={t.id} turn={t} />
      ))}
      {turns.length > 0 && !busy && (
        <button type="button" onClick={() => setTurns([])} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <Trash2 className="h-3 w-3" /> Clear conversation
        </button>
      )}
    </div>
  );
}

function ModeBanner({ mode, model, hasKey }: { mode: 'gemini' | 'demo'; model: string; hasKey: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg border border-line bg-subtle/40 p-3 text-xs text-ink2">
      {mode === 'demo' ? (
        <span className="flex items-start gap-1.5">
          <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>
            <b className="text-ink">Demo mode</b> — no key needed. Each suggested question runs a curated SQL query <b>live on DuckDB</b>, and
            the summary is computed from the real result rows.
          </span>
        </span>
      ) : (
        <span className="flex items-start gap-1.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>
            <b className="text-ink">Gemini · {model}</b> — free-form Text-to-SQL grounded in the live schema, with automatic self-correction
            when DuckDB rejects a query.{!hasKey && ' Add your API key to start.'}
          </span>
        </span>
      )}
      <span className="flex items-start gap-1.5">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
        <span>Read-only guard: only single SELECT statements reach the database.</span>
      </span>
    </div>
  );
}

function KeySettings({
  apiKey,
  model,
  onSave,
  onClear,
  onClose,
}: {
  apiKey: string;
  model: string;
  onSave: (key: string, model: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [k, setK] = useState(apiKey);
  const [m, setM] = useState(model);
  const [reveal, setReveal] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Bring your own Gemini API key</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close settings">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
        <label className="block text-xs">
          <span className="text-muted">API key</span>
          <div className="mt-1 flex items-center rounded-lg border border-line bg-panel focus-within:border-accent">
            <input
              type={reveal ? 'text' : 'password'}
              value={k}
              onChange={(e) => setK(e.target.value.trim())}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
            />
            <button type="button" onClick={() => setReveal((r) => !r)} className="px-2 text-muted hover:text-ink" aria-label="Show key">
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </label>
        <label className="block text-xs">
          <span className="text-muted">Model</span>
          <input
            value={m}
            onChange={(e) => setM(e.target.value.trim())}
            placeholder={DEFAULT_MODEL}
            className="mt-1 h-8 w-full rounded-lg border border-line bg-panel px-2 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Stored only in this browser&apos;s localStorage and sent only to Google&apos;s Gemini API (in a request header, never the URL). Get a key
        at{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent hover:underline">
          aistudio.google.com/apikey
        </a>
        . Prompts include the database schema and query results — all synthetic data.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onSave(k, m)}
          disabled={!k}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> Save
        </button>
        {apiKey && (
          <button
            type="button"
            onClick={() => {
              setK('');
              onClear();
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink2 hover:text-bad"
          >
            Remove key
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const steps = [
    ['1', 'Ground', 'Live catalog, foreign keys, categorical values and metric definitions go into the prompt'],
    ['2', 'Generate', 'Gemini returns one DuckDB query as structured JSON'],
    ['3', 'Guard & execute', 'Read-only check, then DuckDB-Wasm runs it; errors are fed back for self-correction'],
    ['4', 'Explain', 'Summary and recommendation written only from the real result rows'],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map(([n, t, d]) => (
        <div key={n} className="rounded-xl border border-dashed border-line p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[11px] text-accent">{n}</span>
            {t}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{d}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One question → answer
// ─────────────────────────────────────────────────────────────────────────────
function TurnCard({ turn }: { turn: Turn }) {
  const { openInWorkspace } = useApp();
  const [showSql, setShowSql] = useState(false);
  const [showTable, setShowTable] = useState(true);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      <header className="border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold">{turn.question}</h3>
          <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {turn.mode === 'demo' ? 'demo' : turn.model}
            {turn.totalMs !== undefined && ` · ${(turn.totalMs / 1000).toFixed(1)}s`}
          </span>
        </div>
        <StepTrail steps={turn.steps} />
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {turn.status === 'error' && turn.error && <ErrorBox message={turn.error} />}

        {turn.insight && (
          <div className="rounded-lg border border-accent/25 bg-accent/5 p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 space-y-2">
                <p className="text-base font-semibold leading-snug">{turn.insight.headline}</p>
                <p className="text-sm leading-relaxed text-ink2">{turn.insight.summary}</p>
                <div className="flex items-start gap-2 rounded-md bg-panel/70 p-2.5 text-sm leading-relaxed">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--s4)' }} />
                  <span>
                    <b>Recommendation: </b>
                    {turn.insight.recommendation}
                  </span>
                </div>
                {turn.insight.caveat && <p className="text-xs text-muted">Caveat: {turn.insight.caveat}</p>}
              </div>
            </div>
          </div>
        )}
        {turn.status !== 'error' && turn.error && <p className="text-xs text-muted">{turn.error}</p>}

        {turn.chart && turn.rows && <AiChart spec={turn.chart} rows={turn.rows} />}

        {turn.columns && turn.rows && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <button type="button" onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 font-medium text-ink2 hover:text-ink">
                {showTable ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Result · {fmtNum(turn.rows.length)} row{turn.rows.length === 1 ? '' : 's'}
                {turn.queryMs !== undefined && <span className="text-muted"> · {Math.round(turn.queryMs)} ms on DuckDB</span>}
              </button>
            </div>
            {showTable && <DataTable columns={turn.columns} rows={turn.rows} maxRows={50} className="max-h-[320px]" />}
          </div>
        )}

        {turn.sql && (
          <div className="rounded-lg border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <button type="button" onClick={() => setShowSql((v) => !v)} className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink2 hover:text-ink">
                {showSql ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Code2 className="h-3.5 w-3.5" /> Generated SQL
                {turn.repairs.length > 0 && (
                  <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                    self-corrected {turn.repairs.length}×
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => openInWorkspace(turn.sql!, turn.mode === 'demo' ? 'ai_demo_query.sql' : 'ai_generated_query.sql')}
                className="text-xs text-accent hover:underline"
              >
                Open in SQL Workspace →
              </button>
            </div>
            {turn.explanation && <p className="px-3 pb-2 text-xs leading-relaxed text-muted">{turn.explanation}</p>}
            {showSql && (
              <>
                <pre className="scroll-thin overflow-x-auto border-t border-line bg-subtle/40 p-3 font-mono text-[11.5px] leading-relaxed text-ink">
                  {turn.sql}
                </pre>
                {turn.repairs.map((r, i) => (
                  <div key={i} className="border-t border-line p-3 text-[11px]">
                    <div className="mb-1 font-medium text-warn">Attempt {i + 1} rejected by DuckDB — fed back to Gemini:</div>
                    <pre className="whitespace-pre-wrap font-mono text-bad">{r.error}</pre>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StepTrail({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-line">—</span>}
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5',
              s.status === 'done' && 'text-ink2',
              s.status === 'running' && 'bg-accent/10 text-accent',
              s.status === 'error' && 'bg-bad/10 text-bad',
              s.status === 'pending' && 'text-muted/70',
            )}
          >
            {s.status === 'done' && <Check className="h-3 w-3 text-good" />}
            {s.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {s.status === 'error' && <X className="h-3 w-3" />}
            {s.label}
            {s.ms !== undefined && s.status !== 'running' && (
              <span className="tabular text-muted">{s.ms < 1000 ? `${Math.round(s.ms)}ms` : `${(s.ms / 1000).toFixed(1)}s`}</span>
            )}
            {s.note && <span className="text-muted">· {s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto chart — one axis, one unit, colors in fixed categorical order.
// ─────────────────────────────────────────────────────────────────────────────
const AXIS = { tickLine: false, axisLine: false, fontSize: 11 } as const;
const isIsoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

function AiChart({ spec, rows }: { spec: ChartSpec; rows: Turn['rows'] & object }) {
  const fmtValue = (v: number) =>
    spec.unit === 'percent' ? fmtPct(v) : spec.unit === 'money' ? fmtMoney(v, { compact: Math.abs(v) >= 10000 }) : fmtNum(v, Number.isInteger(v) ? 0 : 2);
  const fmtTick = (v: number) => (spec.unit === 'percent' ? fmtPct(v, 0) : spec.unit === 'money' ? fmtMoney(v, { compact: true }) : fmtNum(v));
  const fmtX = (v: unknown) => {
    if (isIsoDate(v)) {
      const str = String(v);
      return str.endsWith('-01') && str.length === 10 ? fmtMonth(str, true) : str.slice(0, 10);
    }
    const s = String(v ?? '');
    return s.length > 18 ? `${s.slice(0, 17)}…` : s;
  };
  const label = (k: string) => k.replace(/_/g, ' ');
  const Chart = spec.type === 'line' ? LineChart : BarChart;

  return (
    <div>
      {spec.y.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3">
          {spec.y.map((k, i) => (
            <LegendDot key={k} color={SERIES[i]} label={label(k)} />
          ))}
        </div>
      )}
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={spec.x} tickFormatter={fmtX} minTickGap={16} {...AXIS} />
            {/* Bars encode magnitude from zero; lines show change, so let them auto-scale. */}
            <YAxis tickFormatter={fmtTick} width={56} domain={spec.type === 'line' ? ['auto', 'auto'] : [0, 'auto']} {...AXIS} />
            <Tooltip
              cursor={spec.type === 'line' ? { stroke: 'var(--chart-axis)' } : { fill: 'rgb(var(--subtle))' }}
              content={(p) => (
                <ChartTooltip {...(p as unknown as TipProps)} formatLabel={(l) => fmtX(l)} formatValue={(v) => fmtValue(v)} />
              )}
            />
            {spec.y.map((k, i) =>
              spec.type === 'line' ? (
                <Line
                  key={k}
                  dataKey={k}
                  name={label(k)}
                  stroke={SERIES[i]}
                  strokeWidth={2}
                  dot={rows.length <= 24 ? { r: 3, strokeWidth: 0, fill: SERIES[i] } : false}
                  activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
                  isAnimationActive={false}
                />
              ) : (
                <Bar key={k} dataKey={k} name={label(k)} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
