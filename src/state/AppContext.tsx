import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QueryVars } from '../lib/query';
import { lastDayOfMonth } from '../lib/format';
import type { BootStats } from '../lib/duckdb';

export type TabId = 'overview' | 'cohorts' | 'funnel' | 'ai' | 'workspace';

export interface Filters {
  startMonth: string; // 'YYYY-MM-01'
  endMonth: string; // 'YYYY-MM-01'
  departmentId: number | null;
  branchId: number | null;
}

export interface Dimension {
  id: number;
  name: string;
}
export interface Dimensions {
  departments: Dimension[];
  branches: Dimension[];
  channels: string[];
  months: string[]; // available months, ascending
}

export interface WorkspaceRequest {
  sql: string;
  title: string;
  run: boolean;
  nonce: number;
}

interface AppState {
  tab: TabId;
  setTab: (t: TabId) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  vars: QueryVars;
  dims: Dimensions;
  stats: BootStats;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  workspaceRequest: WorkspaceRequest | null;
  openInWorkspace: (sql: string, title: string, run?: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ dims, stats, children }: { dims: Dimensions; stats: BootStats; children: ReactNode }) {
  const [tab, setTab] = useState<TabId>(() => {
    const h = window.location.hash.replace('#', '') as TabId;
    return ['overview', 'cohorts', 'funnel', 'ai', 'workspace'].includes(h) ? h : 'overview';
  });
  const [filters, setFilters] = useState<Filters>({
    startMonth: dims.months[0],
    endMonth: dims.months[dims.months.length - 1],
    departmentId: null,
    branchId: null,
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const [workspaceRequest, setWorkspaceRequest] = useState<WorkspaceRequest | null>(null);

  useEffect(() => {
    if (window.location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* storage unavailable — theme still applies for this session */
      }
      return next;
    });
  }, []);

  const openInWorkspace = useCallback((sql: string, title: string, run = true) => {
    setWorkspaceRequest({ sql, title, run, nonce: Date.now() });
    setTab('workspace');
  }, []);

  const vars = useMemo<QueryVars>(
    () => ({
      start_date: filters.startMonth,
      end_date: lastDayOfMonth(filters.endMonth),
      department_id: filters.departmentId,
      branch_id: filters.branchId,
      channel: null,
    }),
    [filters],
  );

  const value: AppState = {
    tab,
    setTab,
    filters,
    setFilters,
    vars,
    dims,
    stats,
    theme,
    toggleTheme,
    workspaceRequest,
    openInWorkspace,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
