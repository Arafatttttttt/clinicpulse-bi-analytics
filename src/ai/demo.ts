/**
 * Demo mode: lets anyone try the AI analyst without an API key.
 *
 * Each prompt chip maps to a curated SQL query that is EXECUTED LIVE against
 * DuckDB, and the narrative is computed from those live results — so every
 * number on screen is real. Only the free-form language generation needs Gemini.
 */
import type { Row } from '../lib/query';
import { fmtMoney, fmtMonth, fmtPct, fmtPp } from '../lib/format';
import type { ChartHint } from './chart';

export interface Insight {
  headline: string;
  summary: string;
  recommendation: string;
  caveat: string;
}

export interface DemoQuestion {
  question: string;
  explanation: string;
  sql: string;
  chart: ChartHint;
  narrate: (rows: Row[]) => Insight;
}

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    question: 'Which department had the highest no-show spike last quarter and how much revenue did we lose?',
    explanation:
      'Compares each department’s no-show rate in Q3 2026 vs Q2 2026 (no-shows ÷ completed + no-shows) and prices the missed appointments at their quoted net value; "excess" isolates the loss above the Q2 rate.',
    sql: `WITH quarterly AS (
    SELECT
        department_name,
        CASE WHEN visit_date >= DATE '2026-07-01' THEN 'q3' ELSE 'q2' END  AS quarter,
        COUNT(*) FILTER (WHERE is_no_show)                                 AS no_shows,
        COUNT(*) FILTER (WHERE is_completed OR is_no_show)                 AS kept_appointments,
        SUM(billed_amount - discount) FILTER (WHERE is_no_show)            AS lost_revenue
    FROM fct_visits
    WHERE visit_date BETWEEN DATE '2026-04-01' AND DATE '2026-09-30'
    GROUP BY ALL
),
pivoted AS (
    SELECT
        department_name,
        MAX(no_shows::DOUBLE / kept_appointments) FILTER (WHERE quarter = 'q2') AS q2_rate,
        MAX(no_shows::DOUBLE / kept_appointments) FILTER (WHERE quarter = 'q3') AS q3_rate,
        MAX(no_shows)          FILTER (WHERE quarter = 'q3')                     AS q3_no_shows,
        MAX(kept_appointments) FILTER (WHERE quarter = 'q3')                     AS q3_appointments,
        MAX(lost_revenue)      FILTER (WHERE quarter = 'q3')                     AS q3_lost_revenue
    FROM quarterly
    GROUP BY department_name
)
SELECT
    department_name,
    ROUND(q2_rate, 4)                                              AS q2_no_show_rate,
    ROUND(q3_rate, 4)                                              AS q3_no_show_rate,
    ROUND(q3_rate - q2_rate, 4)                                    AS spike_pp,
    q3_no_shows,
    ROUND(q3_lost_revenue, 2)                                      AS q3_lost_revenue,
    -- extra no-shows above the Q2 rate × average ticket of a missed visit
    ROUND(GREATEST(q3_rate - q2_rate, 0) * q3_appointments
          * (q3_lost_revenue / NULLIF(q3_no_shows, 0)), 2)         AS excess_lost_revenue
FROM pivoted
ORDER BY spike_pp DESC`,
    chart: { type: 'bar', x: 'department_name', y: ['q2_no_show_rate', 'q3_no_show_rate'] },
    narrate: (rows) => {
      const [top, next] = rows;
      if (!top) return empty();
      const dept = s(top.department_name);
      return {
        headline: `${dept} no-shows jumped ${fmtPp(n(top.spike_pp))} in Q3 2026`,
        summary: `${dept}'s no-show rate rose from ${fmtPct(n(top.q2_no_show_rate))} in Q2 to ${fmtPct(n(top.q3_no_show_rate))} in Q3 — the largest increase of any department${next ? ` (runner-up: ${s(next.department_name)}, ${fmtPp(n(next.spike_pp))})` : ''}. Its ${n(top.q3_no_shows).toLocaleString('en-US')} Q3 no-shows were worth ${fmtMoney(n(top.q3_lost_revenue))}, of which about ${fmtMoney(n(top.excess_lost_revenue))} is excess loss above its Q2 rate.`,
        recommendation: `Audit ${dept}'s reminder and confirmation workflow for anything that changed at the start of Q3, and reinstate 24-hour SMS plus call reminders. Until the rate is back near ${fmtPct(n(top.q2_no_show_rate))}, overbook its highest-risk slots modestly.`,
        caveat: 'Lost revenue prices missed appointments at their quoted value; some patients rebook, so the realized loss is lower.',
      };
    },
  },
  {
    question: 'What was our month-over-month revenue growth over the last 12 months?',
    explanation: 'Monthly net revenue (completed visits, net of discounts) with LAG() for MoM growth and a running total.',
    sql: `WITH monthly AS (
    SELECT
        visit_month,
        SUM(net_revenue)                       AS revenue,
        COUNT(*) FILTER (WHERE is_completed)   AS completed_visits
    FROM fct_visits
    GROUP BY visit_month
)
SELECT
    visit_month,
    ROUND(revenue, 2)                                                  AS revenue,
    completed_visits,
    ROUND(revenue / LAG(revenue) OVER (ORDER BY visit_month) - 1, 4)   AS mom_growth_rate,
    ROUND(SUM(revenue) OVER (ORDER BY visit_month), 2)                 AS cumulative_revenue
FROM monthly
ORDER BY visit_month`,
    chart: { type: 'bar', x: 'visit_month', y: ['revenue'] },
    narrate: (rows) => {
      if (rows.length < 2) return empty();
      const first = rows[0];
      const last = rows[rows.length - 1];
      const growth = rows.filter((r) => r.mom_growth_rate !== null);
      const worst = growth.reduce((a, b) => (n(b.mom_growth_rate) < n(a.mom_growth_rate) ? b : a));
      const best = growth.reduce((a, b) => (n(b.mom_growth_rate) > n(a.mom_growth_rate) ? b : a));
      const cmgr = Math.pow(n(last.revenue) / n(first.revenue), 1 / (rows.length - 1)) - 1;
      return {
        headline: `Revenue up ${fmtPct(n(last.revenue) / n(first.revenue) - 1, 0)} in 12 months; ${fmtMonth(s(worst.visit_month)).split(' ')[0]} was the weak spot`,
        summary: `Monthly revenue grew from ${fmtMoney(n(first.revenue))} in ${fmtMonth(s(first.visit_month))} to ${fmtMoney(n(last.revenue))} in ${fmtMonth(s(last.visit_month))} — a compound ${fmtPct(cmgr)} per month and ${fmtMoney(n(last.cumulative_revenue), { compact: true })} in total. The sharpest decline was ${fmtMonth(s(worst.visit_month))} (${fmtPct(n(worst.mom_growth_rate))} MoM) and the strongest month-over-month gain ${fmtMonth(s(best.visit_month))} (+${fmtPct(n(best.mom_growth_rate))}).`,
        recommendation: `Break down ${fmtMonth(s(worst.visit_month))} by department and branch to separate seasonal demand from operational losses (no-shows, unconfirmed bookings). Schedule recall campaigns ahead of that month next year so the dip doesn't repeat.`,
        caveat: 'Revenue is accrual-based on visit date; cash from insurers arrives 2–7 weeks later.',
      };
    },
  },
  {
    question: 'Who are the top 3 doctors by 60-day patient retention (min 50 patients)?',
    explanation:
      'For every completed visit, LEAD() finds the patient’s next completed visit; retention = share followed by a return within 60 days. Only visits up to 2026-09-01 are scored so each has a full 60-day window.',
    sql: `WITH completed AS (
    SELECT
        doctor_id,
        patient_id,
        scheduled_at,
        LEAD(scheduled_at) OVER (PARTITION BY patient_id ORDER BY scheduled_at) AS next_visit_at
    FROM fct_visits
    WHERE is_completed
),
scored AS (
    SELECT
        doctor_id,
        COUNT(DISTINCT patient_id)                                                       AS patients,
        AVG(COALESCE(next_visit_at <= scheduled_at + INTERVAL 60 DAY, FALSE)::INTEGER)   AS retention_rate
    FROM completed
    WHERE scheduled_at < TIMESTAMP '2026-09-02'
    GROUP BY doctor_id
)
SELECT
    d.full_name,
    dep.department_name,
    b.branch_name,
    d.seniority,
    s.patients,
    ROUND(s.retention_rate, 4)                                                              AS retention_60d_rate,
    ROUND(s.retention_rate - AVG(s.retention_rate) OVER (PARTITION BY dep.department_id), 4) AS vs_department_avg_pp
FROM scored s
JOIN doctors     d   USING (doctor_id)
JOIN departments dep ON dep.department_id = d.department_id
JOIN branches    b   ON b.branch_id = d.branch_id
WHERE s.patients >= 50
ORDER BY retention_60d_rate DESC
LIMIT 3`,
    chart: { type: 'bar', x: 'full_name', y: ['retention_60d_rate'] },
    narrate: (rows) => {
      if (rows.length === 0) return empty();
      const [a] = rows;
      const list = rows.map((r) => `${s(r.full_name)} (${s(r.department_name)}, ${fmtPct(n(r.retention_60d_rate))})`).join(', ');
      return {
        headline: `${s(a.full_name)} leads 60-day patient retention at ${fmtPct(n(a.retention_60d_rate))}`,
        summary: `The top three doctors by 60-day retention are ${list}. ${s(a.full_name)} beats the ${s(a.department_name)} peer average by ${fmtPp(n(a.vs_department_avg_pp))}, so the lead is not just a department effect.`,
        recommendation: `Document how these doctors schedule follow-ups (booking the next visit at checkout, care plans). Pilot that protocol with the lowest-retention doctors in the same departments and re-measure in 60 days.`,
        caveat: 'Retention differs structurally by specialty (e.g. cardiology follow-ups), so compare doctors within a department, not across.',
      };
    },
  },
  {
    question: 'Which acquisition channel brings the most valuable patients by 90-day LTV?',
    explanation:
      'New patients only (legacy patients are left-censored). LTV = net revenue within 90 days of the first completed visit, for patients first seen ≥ 90 days before the end of the data.',
    sql: `WITH first_visit AS (
    SELECT
        patient_id,
        ANY_VALUE(acquisition_channel)  AS acquisition_channel,
        MIN(scheduled_at)               AS first_visit_at
    FROM fct_visits
    WHERE is_completed AND is_new_patient
    GROUP BY patient_id
),
eligible AS (
    SELECT * FROM first_visit WHERE first_visit_at <= TIMESTAMP '2026-08-02'
),
ltv AS (
    SELECT
        e.patient_id,
        e.acquisition_channel,
        SUM(v.net_revenue)                       AS ltv_90d,
        COUNT(*) FILTER (WHERE v.is_completed)   AS visits_90d
    FROM eligible e
    JOIN fct_visits v
      ON v.patient_id = e.patient_id
     AND v.scheduled_at < e.first_visit_at + INTERVAL 90 DAY
    GROUP BY ALL
)
SELECT
    acquisition_channel,
    COUNT(*)                                  AS new_patients,
    ROUND(AVG(ltv_90d), 2)                    AS avg_ltv_90d,
    ROUND(AVG((visits_90d > 1)::INTEGER), 4)  AS repeat_90d_rate,
    ROUND(SUM(ltv_90d), 2)                    AS total_revenue_90d
FROM ltv
GROUP BY acquisition_channel
ORDER BY avg_ltv_90d DESC`,
    chart: { type: 'bar', x: 'acquisition_channel', y: ['avg_ltv_90d'] },
    narrate: (rows) => {
      if (rows.length < 2) return empty();
      const best = rows[0];
      const worst = rows[rows.length - 1];
      return {
        headline: `${s(best.acquisition_channel)} patients are worth ${(n(best.avg_ltv_90d) / n(worst.avg_ltv_90d)).toFixed(1)}× ${s(worst.acquisition_channel)} patients`,
        summary: `${s(best.acquisition_channel)} patients generate ${fmtMoney(n(best.avg_ltv_90d))} in their first 90 days with a ${fmtPct(n(best.repeat_90d_rate))} repeat rate, versus ${fmtMoney(n(worst.avg_ltv_90d))} and ${fmtPct(n(worst.repeat_90d_rate))} for ${s(worst.acquisition_channel)}. ${s(worst.acquisition_channel)} brought ${n(worst.new_patients).toLocaleString('en-US')} new patients — volume, but not value.`,
        recommendation: `Bring in acquisition cost per channel and rebalance spend toward the channels with the best LTV:CAC. For ${s(worst.acquisition_channel)}, test a follow-up offer at the first visit before scaling the budget further.`,
        caveat: 'Acquisition cost is not in this database, so this ranks patient value, not channel ROI.',
      };
    },
  },
  {
    question: 'Which branch has the worst booking-to-attendance conversion, and when did it start?',
    explanation: 'Monthly share of ALL bookings that ended in an attended visit, one column per branch (wide format for charting).',
    sql: `SELECT
    visit_month,
    ROUND(AVG(is_completed::INTEGER) FILTER (WHERE branch_name = 'Central Campus'), 4)  AS central_campus_conversion_rate,
    ROUND(AVG(is_completed::INTEGER) FILTER (WHERE branch_name = 'Northside'), 4)       AS northside_conversion_rate,
    ROUND(AVG(is_completed::INTEGER) FILTER (WHERE branch_name = 'Riverside'), 4)       AS riverside_conversion_rate
FROM fct_visits
GROUP BY visit_month
ORDER BY visit_month`,
    chart: {
      type: 'line',
      x: 'visit_month',
      y: ['central_campus_conversion_rate', 'northside_conversion_rate', 'riverside_conversion_rate'],
    },
    narrate: (rows) => {
      if (rows.length < 5) return empty();
      const series = [
        { name: 'Central Campus', key: 'central_campus_conversion_rate' },
        { name: 'Northside', key: 'northside_conversion_rate' },
        { name: 'Riverside', key: 'riverside_conversion_rate' },
      ];
      const recent = (k: string) => rows.slice(-3).reduce((a, r) => a + n(r[k]), 0) / 3;
      const worst = series.reduce((a, b) => (recent(b.key) < recent(a.key) ? b : a));
      const others = series.filter((x) => x !== worst);
      const othersAvg = others.reduce((a, b) => a + recent(b.key), 0) / others.length;
      // First month that falls > 5 pp below the branch's own trailing 3-month mean.
      let start: Row | undefined;
      let baseline = 0;
      for (let i = 3; i < rows.length; i++) {
        const prev = rows.slice(i - 3, i).reduce((a, r) => a + n(r[worst.key]), 0) / 3;
        if (n(rows[i][worst.key]) < prev - 0.05) {
          start = rows[i];
          baseline = prev;
          break;
        }
      }
      return {
        headline: start
          ? `${worst.name} conversion broke down in ${fmtMonth(s(start.visit_month))}`
          : `${worst.name} has the lowest booking-to-attendance conversion`,
        summary: start
          ? `${worst.name} converted ${fmtPct(n(start[worst.key]))} of bookings into attended visits in ${fmtMonth(s(start.visit_month))}, down from a ${fmtPct(baseline)} trailing average. Over the last three months it averaged ${fmtPct(recent(worst.key))} versus ${fmtPct(othersAvg)} at the other branches.`
          : `${worst.name} averaged ${fmtPct(recent(worst.key))} over the last three months versus ${fmtPct(othersAvg)} at the other branches.`,
        recommendation: `Check what changed at ${worst.name}${start ? ` in ${fmtMonth(s(start.visit_month))}` : ''}: front-desk and call-center staffing, the confirmation process, and the booking system. Add a daily "unconfirmed bookings for tomorrow" call list until conversion recovers to network level.`,
        caveat: 'Conversion here is outcome-based; split it into confirmation vs attendance to pinpoint the failing step.',
      };
    },
  },
];

function empty(): Insight {
  return {
    headline: 'No rows returned',
    summary: 'The query ran but returned no data for this question.',
    recommendation: 'Check the filters and date range used in the SQL.',
    caveat: '',
  };
}
