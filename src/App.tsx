import clsx from 'clsx';
import { Activity, Filter, Grid3x3, LayoutDashboard, Moon, RotateCcw, Sun, TerminalSquare } from 'lucide-react';
import { useApp, type TabId } from './state/AppContext';
import { Select } from './components/ui';
import { fmtMonth, fmtNum } from './lib/format';
import Overview from './modules/Overview';
import Cohorts from './modules/Cohorts';
import Funnel from './modules/Funnel';
import Workspace from './modules/Workspace';

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard; blurb: string }[] = [
  { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard, blurb: 'Revenue, KPIs & unit economics' },
  { id: 'cohorts', label: 'Cohort Retention', icon: Grid3x3, blurb: 'Retention & LTV by acquisition month' },
  { id: 'funnel', label: 'Conversion Funnel', icon: Filter, blurb: 'Patient journey & bottlenecks' },
  { id: 'workspace', label: 'SQL Workspace', icon: TerminalSquare, blurb: 'Schema explorer & live SQL' },
];

export default function App() {
  const { tab, setTab, theme, toggleTheme, stats } = useApp();
  const active = NAV.find((n) => n.id === tab)!;

  return (
    <div className="flex min-h-full">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <Brand />
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
                tab === n.id ? 'bg-subtle font-medium text-ink' : 'text-ink2 hover:bg-subtle/60 hover:text-ink',
              )}
            >
              <n.icon className={clsx('h-4 w-4', tab === n.id ? 'text-accent' : 'text-muted')} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="m-3 rounded-lg border border-line bg-subtle/50 p-3 text-[11px] leading-relaxed text-muted">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-ink2">
            <span className="h-1.5 w-1.5 rounded-full bg-good" /> DuckDB {stats.duckdbVersion}
          </div>
          <div className="tabular">{fmtNum(stats.totalRows)} rows · 6 tables</div>
          <div className="tabular">Loaded in {fmtNum(stats.bootMs)} ms · in-browser</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        {/* Sticky only on desktop: on phones the wrapped filter bar would eat the viewport. */}
        <header className="z-20 border-b border-line bg-bg/85 backdrop-blur lg:sticky lg:top-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="lg:hidden">
                <Logo />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight">{active.label}</h1>
                <p className="hidden truncate text-xs text-muted sm:block">{active.blurb}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-ink2 transition hover:text-ink"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
          {/* Mobile tabs */}
          <nav className="scroll-thin flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setTab(n.id)}
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs',
                  tab === n.id ? 'bg-panel font-medium text-ink shadow-card' : 'text-muted',
                )}
              >
                <n.icon className="h-3.5 w-3.5" />
                {n.label}
              </button>
            ))}
          </nav>
          {tab !== 'workspace' && <FilterBar />}
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6">
          {tab === 'overview' && <Overview />}
          {tab === 'cohorts' && <Cohorts />}
          {tab === 'funnel' && <Funnel />}
          {/* Keep the workspace mounted so editor contents survive tab switches. */}
          <div className={tab === 'workspace' ? '' : 'hidden'}>
            <Workspace />
          </div>
        </main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
      <Activity className="h-4 w-4" strokeWidth={2.5} />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <Logo />
      <div>
        <div className="text-sm font-semibold tracking-tight">ClinicPulse</div>
        <div className="text-[11px] text-muted">Self-service BI</div>
      </div>
    </div>
  );
}

function FilterBar() {
  const { filters, setFilters, dims } = useApp();
  const months = dims.months;
  const last = months[months.length - 1];
  const presets: { label: string; n: number }[] = [
    { label: '12M', n: 12 },
    { label: '6M', n: 6 },
    { label: '3M', n: 3 },
  ];
  const isPreset = (n: number) => filters.endMonth === last && filters.startMonth === months[Math.max(0, months.length - n)];
  const dirty =
    filters.departmentId !== null || filters.branchId !== null || filters.startMonth !== months[0] || filters.endMonth !== last;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/70 px-4 py-2 sm:px-6">
      <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setFilters({ ...filters, startMonth: months[Math.max(0, months.length - p.n)], endMonth: last })}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition',
              isPreset(p.n) ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <Select
        label="From"
        value={filters.startMonth}
        onChange={(v) => setFilters({ ...filters, startMonth: v, endMonth: v > filters.endMonth ? v : filters.endMonth })}
        options={months.map((m) => ({ value: m, label: fmtMonth(m) }))}
      />
      <Select
        label="To"
        value={filters.endMonth}
        onChange={(v) => setFilters({ ...filters, endMonth: v, startMonth: v < filters.startMonth ? v : filters.startMonth })}
        options={months.map((m) => ({ value: m, label: fmtMonth(m) }))}
      />
      <Select
        label="Department"
        value={filters.departmentId === null ? '' : String(filters.departmentId)}
        onChange={(v) => setFilters({ ...filters, departmentId: v ? Number(v) : null })}
        options={[{ value: '', label: 'All departments' }, ...dims.departments.map((d) => ({ value: String(d.id), label: d.name }))]}
      />
      <Select
        label="Branch"
        value={filters.branchId === null ? '' : String(filters.branchId)}
        onChange={(v) => setFilters({ ...filters, branchId: v ? Number(v) : null })}
        options={[{ value: '', label: 'All branches' }, ...dims.branches.map((d) => ({ value: String(d.id), label: d.name }))]}
      />
      {dirty && (
        <button
          type="button"
          onClick={() => setFilters({ startMonth: months[0], endMonth: last, departmentId: null, branchId: null })}
          className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-ink"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      )}
    </div>
  );
}
