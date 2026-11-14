/**
 * AI analyst pipeline — one "turn" per question:
 *
 *   1. Ground   build schema + semantic-layer context from the live catalog
 *   2. Generate Gemini writes SQL (structured JSON output)
 *   3. Guard    reject anything that is not a single read-only SELECT
 *   4. Execute  run it on DuckDB-Wasm; on error, feed the DuckDB message back
 *               to Gemini and let it self-correct (up to MAX_REPAIRS times)
 *   5. Explain  Gemini writes an executive summary from the REAL result rows
 *
 * Demo mode runs the same steps with curated SQL and a narrative computed
 * from the live results, so it needs no API key.
 */
import { runQuery, type ColumnInfo, type Row } from '../lib/query';
import { generateJson, type GeminiContent } from './gemini';
import { getSchemaContext } from './schemaContext';
import { guardSql } from './sqlGuard';
import { INSIGHT_RESPONSE_SCHEMA, INSIGHT_SYSTEM_PROMPT, SQL_RESPONSE_SCHEMA, sqlSystemPrompt } from './prompts';
import { resolveChart, type ChartHint, type ChartSpec } from './chart';
import type { DemoQuestion, Insight } from './demo';

const MAX_REPAIRS = 2;
const ROWS_FOR_SUMMARY = 60;

export type StepId = 'ground' | 'generate' | 'execute' | 'explain';
export type StepStatus = 'pending' | 'running' | 'done' | 'error';
export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
  ms?: number;
  note?: string;
}

export interface Turn {
  id: string;
  question: string;
  mode: 'gemini' | 'demo';
  model?: string;
  status: 'running' | 'done' | 'error';
  steps: Step[];
  explanation?: string;
  sql?: string;
  columns?: ColumnInfo[];
  rows?: Row[];
  queryMs?: number;
  chart?: ChartSpec | null;
  insight?: Insight;
  repairs: { sql: string; error: string }[];
  error?: string;
  startedAt: number;
  totalMs?: number;
}

interface SqlResponse {
  explanation: string;
  sql: string;
  chart: ChartHint;
}

export interface GeminiSettings {
  apiKey: string;
  model: string;
}

type Update = (turn: Turn) => void;

function newTurn(question: string, mode: Turn['mode'], model?: string): Turn {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    question,
    mode,
    model,
    status: 'running',
    repairs: [],
    startedAt: performance.now(),
    steps: [
      { id: 'ground', label: 'Ground in schema', status: 'pending' },
      { id: 'generate', label: mode === 'demo' ? 'Load curated SQL' : 'Generate SQL', status: 'pending' },
      { id: 'execute', label: 'Execute on DuckDB', status: 'pending' },
      { id: 'explain', label: mode === 'demo' ? 'Narrate from results' : 'Write executive summary', status: 'pending' },
    ],
  };
}

/** Small helper that times a step and publishes immutable updates. */
function stepper(turn: Turn, update: Update) {
  let current = turn;
  const publish = (patch: Partial<Turn>) => {
    current = { ...current, ...patch };
    update(current);
  };
  const setStep = (id: StepId, patch: Partial<Step>) => {
    publish({ steps: current.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  };
  async function step<T>(id: StepId, fn: () => Promise<T>, note?: (v: T) => string | undefined): Promise<T> {
    const t0 = performance.now();
    setStep(id, { status: 'running' });
    try {
      const v = await fn();
      setStep(id, { status: 'done', ms: performance.now() - t0, note: note?.(v) });
      return v;
    } catch (e) {
      setStep(id, { status: 'error', ms: performance.now() - t0 });
      throw e;
    }
  }
  return { publish, setStep, step, get: () => current };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toCsv(columns: ColumnInfo[], rows: Row[]): string {
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    const str = String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [columns.map((c) => c.name).join(','), ...rows.map((r) => columns.map((c) => fmt(r[c.name])).join(','))].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini mode
// ─────────────────────────────────────────────────────────────────────────────
export async function runGeminiTurn(
  question: string,
  settings: GeminiSettings,
  history: Turn[],
  update: Update,
  signal?: AbortSignal,
): Promise<Turn> {
  const s = stepper(newTurn(question, 'gemini', settings.model), update);
  s.publish({});
  try {
    const schema = await s.step('ground', getSchemaContext, () => 'live catalog + metric definitions');
    const system = sqlSystemPrompt(schema);

    // Short conversational memory: previous questions and the SQL that answered them.
    const contents: GeminiContent[] = [];
    for (const h of history.slice(-3)) {
      if (h.status !== 'done' || !h.sql) continue;
      contents.push({ role: 'user', parts: [{ text: h.question }] });
      contents.push({ role: 'model', parts: [{ text: JSON.stringify({ explanation: h.explanation, sql: h.sql }) }] });
    }
    contents.push({ role: 'user', parts: [{ text: question }] });

    let response: SqlResponse | null = null;
    let result: { columns: ColumnInfo[]; rows: Row[]; ms: number } | null = null;
    let sql = '';
    for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
      const label = attempt === 0 ? undefined : `self-correction #${attempt}`;
      response = await s.step(
        'generate',
        () => generateJson<SqlResponse>({ apiKey: settings.apiKey, model: settings.model, system, contents, schema: SQL_RESPONSE_SCHEMA, signal }),
        () => label,
      );
      s.publish({ explanation: response.explanation, sql: response.sql });
      try {
        sql = guardSql(response.sql);
        const r = await s.step('execute', () => runQuery(sql), (v) => `${v.rows.length} rows`);
        result = r;
        break;
      } catch (e) {
        const error = errMsg(e);
        s.publish({ repairs: [...s.get().repairs, { sql: response.sql, error }] });
        if (attempt === MAX_REPAIRS) throw new Error(`The generated SQL still failed after ${MAX_REPAIRS} self-corrections: ${error}`);
        s.setStep('execute', { status: 'pending', note: undefined });
        contents.push({ role: 'model', parts: [{ text: JSON.stringify(response) }] });
        contents.push({
          role: 'user',
          parts: [{ text: `That query failed in DuckDB:\n${error}\n\nReturn a corrected query that answers the original question. Use only the documented tables and columns.` }],
        });
      }
    }
    if (!result || !response) throw new Error('No result');

    s.publish({
      sql,
      columns: result.columns,
      rows: result.rows,
      queryMs: result.ms,
      chart: resolveChart(response.chart, result.columns, result.rows),
    });

    // Summary is best-effort: a failure here still leaves the data and chart on screen.
    try {
      const insight = await s.step('explain', () =>
        generateJson<Insight>({
          apiKey: settings.apiKey,
          model: settings.model,
          system: INSIGHT_SYSTEM_PROMPT,
          schema: INSIGHT_RESPONSE_SCHEMA,
          thinkingBudget: 0,
          temperature: 0.3,
          signal,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Question: ${question}\n\nSQL:\n${sql}\n\nResult (${result.rows.length} rows${result.rows.length > ROWS_FOR_SUMMARY ? `, first ${ROWS_FOR_SUMMARY} shown` : ''}):\n${toCsv(result.columns, result.rows.slice(0, ROWS_FOR_SUMMARY))}`,
                },
              ],
            },
          ],
        }),
      );
      s.publish({ insight });
    } catch (e) {
      s.publish({ error: `Summary unavailable: ${errMsg(e)}` });
    }
    s.publish({ status: 'done', totalMs: performance.now() - s.get().startedAt });
  } catch (e) {
    s.publish({ status: 'error', error: errMsg(e), totalMs: performance.now() - s.get().startedAt });
  }
  return s.get();
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo mode
// ─────────────────────────────────────────────────────────────────────────────
export async function runDemoTurn(demo: DemoQuestion, update: Update): Promise<Turn> {
  const s = stepper(newTurn(demo.question, 'demo'), update);
  s.publish({});
  try {
    await s.step('ground', getSchemaContext, () => 'live catalog + metric definitions');
    await s.step('generate', async () => {
      s.publish({ explanation: demo.explanation, sql: demo.sql });
    }, () => 'curated');
    const sql = guardSql(demo.sql);
    const result = await s.step('execute', () => runQuery(sql), (v) => `${v.rows.length} rows`);
    s.publish({
      columns: result.columns,
      rows: result.rows,
      queryMs: result.ms,
      chart: resolveChart(demo.chart, result.columns, result.rows),
    });
    const insight = await s.step('explain', async () => demo.narrate(result.rows), () => 'computed from live rows');
    s.publish({ insight, status: 'done', totalMs: performance.now() - s.get().startedAt });
  } catch (e) {
    s.publish({ status: 'error', error: errMsg(e), totalMs: performance.now() - s.get().startedAt });
  }
  return s.get();
}
