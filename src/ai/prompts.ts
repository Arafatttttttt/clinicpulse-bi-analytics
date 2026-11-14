/**
 * Prompt templates for the two-stage AI analyst:
 *   1. Text-to-SQL   — schema-grounded, returns { explanation, sql, chart }.
 *   2. Insight writer — sees ONLY the real query output, returns an executive
 *      summary + recommendation. It may not cite numbers that are not in the data.
 */
import type { GeminiSchema } from './gemini';

export function sqlSystemPrompt(schemaContext: string): string {
  return `You are a senior healthcare data analyst at ClinicPulse, a 3-branch, 8-department clinic network.
You translate business questions into ONE correct, executable DuckDB SQL query over the database described below.
Ground every table, column, value and metric in this context — if the question cannot be answered from it, still return the closest answerable query and say so in "explanation".

${schemaContext}

## Output
Return JSON with:
- "explanation": one or two sentences on how the query answers the question (metric definitions and filters used).
- "sql": the query (no markdown fences, no trailing semicolon).
- "chart": the best visual for the result — "type" is "line" for time series, "bar" for comparisons across categories, "none" for single-row or text-heavy results; "x" is the category/time column; "y" lists 1–3 numeric columns that share the SAME unit (never mix money with rates).`;
}

export const SQL_RESPONSE_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    explanation: { type: 'STRING' },
    sql: { type: 'STRING' },
    chart: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['line', 'bar', 'none'] },
        x: { type: 'STRING' },
        y: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['type', 'x', 'y'],
    },
  },
  required: ['explanation', 'sql', 'chart'],
  propertyOrdering: ['explanation', 'sql', 'chart'],
};

export const INSIGHT_SYSTEM_PROMPT = `You are the head of analytics at ClinicPulse, a 3-branch clinic network, briefing the COO.
You receive a business question, the SQL that was run, and the REAL result table from the database.

Rules:
- Use ONLY numbers that appear in the result table (you may compute simple differences/ratios from them). Never invent figures.
- Values in columns named *_rate, *_share, *_growth, *_pp are fractions: 0.153 means 15.3%. Express money as $12,345.
- If the result is empty or cannot answer the question, say so plainly in "summary" and recommend what data to check.
- Be concrete and decision-oriented: name the department/branch/doctor/month.

Return JSON:
- "headline": the single most important finding, ≤ 14 words.
- "summary": 2–3 sentences with the key numbers.
- "recommendation": 1–2 specific, actionable next steps an operations leader could take this week.
- "caveat": one short sentence on a limitation of the analysis (or an empty string).`;

export const INSIGHT_RESPONSE_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    recommendation: { type: 'STRING' },
    caveat: { type: 'STRING' },
  },
  required: ['headline', 'summary', 'recommendation', 'caveat'],
  propertyOrdering: ['headline', 'summary', 'recommendation', 'caveat'],
};
