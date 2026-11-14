import { useEffect, useState } from 'react';
import { runQuery, type QueryVars, type Row } from './query';
import { sqlFile } from './sql';

export interface SqlState<T> {
  data: T[] | null;
  error: string | null;
  loading: boolean;
  ms: number | null;
}

/**
 * Runs a named file from /sql_queries with the given session variables.
 * Keeps the previous result on screen while a new one loads (no flicker).
 */
export function useSql<T = Row>(fileName: string, vars: QueryVars): SqlState<T> {
  const [state, setState] = useState<SqlState<T>>({ data: null, error: null, loading: true, ms: null });
  const varsKey = JSON.stringify(vars);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    runQuery<T>(sqlFile(fileName).sql, JSON.parse(varsKey) as QueryVars)
      .then((r) => {
        if (!cancelled) setState({ data: r.rows, error: null, loading: false, ms: r.ms });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false, ms: null });
      });
    return () => {
      cancelled = true;
    };
  }, [fileName, varsKey]);

  return state;
}
