/**
 * Deterministic synthetic data generator for the ClinicPulse clinic network.
 *
 * Produces a normalized, FK-consistent dataset covering 12 full months
 * (2025-11-01 .. 2026-10-31) for six tables:
 *
 *   branches ─┐
 *   departments ─┬─ doctors ─┐
 *   patients ────┴───────────┴─ visits ── payments
 *
 * The data is NOT uniform noise. It is simulated patient-by-patient with
 * business mechanics baked in so the dashboards surface real, explainable
 * insights:
 *
 *  1. Seasonality      – winter flu peak (General Medicine / Pediatrics),
 *                        spring–summer Dermatology peak, July–August dip.
 *  2. Weekly pattern   – Saturday ~50% and Sunday ~20% of weekday volume.
 *  3. Growth           – ~1.8% month-over-month new patient growth + a
 *                        6% price indexation on 2026-04-01.
 *  4. ANOMALY A        – Dermatology "SMS reminder outage" from 2026-08-01:
 *                        confirmation rate drops and no-shows jump ~8% → ~28%.
 *  5. ANOMALY B        – Riverside branch call-center understaffing from
 *                        2026-09-01: booking confirmation rate falls ~91% → ~66%.
 *  6. Cohort quality   – a summer Instagram campaign (mid-Jun → Jul 2026)
 *                        acquires many low-retention patients, visible as
 *                        weaker Jun/Jul cohorts in the retention heatmap.
 *  7. Receivables      – insurance claims settle 12–47 days after the visit,
 *                        so late-October claims are still `pending`; ~4% of
 *                        claims are `denied`.
 *
 * The module is dependency-free and only uses erasable TypeScript syntax so it
 * can run both in the browser (Vite) and in Node 22+ (`node scripts/export-data.ts`).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Row types (mirror sql_queries/00_schema.sql)
// ─────────────────────────────────────────────────────────────────────────────
export interface Branch {
  branch_id: number;
  branch_name: string;
  city_district: string;
  opened_date: string;
}
export interface Department {
  department_id: number;
  department_name: string;
  specialty_group: string;
  base_price: number;
}
export interface Doctor {
  doctor_id: number;
  full_name: string;
  department_id: number;
  branch_id: number;
  seniority: 'Junior' | 'Mid' | 'Senior';
  hire_date: string;
  commission_rate: number;
}
export interface Patient {
  patient_id: number;
  registered_at: string;
  birth_year: number;
  gender: 'F' | 'M';
  acquisition_channel: string;
  insurance_type: string;
  home_branch_id: number;
}
export interface Visit {
  visit_id: number;
  patient_id: number;
  doctor_id: number;
  department_id: number;
  branch_id: number;
  booking_created_at: string;
  scheduled_at: string;
  confirmed_at: string | null;
  status: 'completed' | 'no_show' | 'cancelled';
  visit_type: 'initial' | 'follow_up';
  billed_amount: number;
  discount: number;
  service_cost: number;
}
export interface Payment {
  payment_id: number;
  visit_id: number;
  payment_date: string | null;
  paid_amount: number;
  method: 'card' | 'cash' | 'insurance';
  status: 'paid' | 'partial' | 'pending' | 'denied' | 'refunded';
}
export interface Dataset {
  branches: Branch[];
  departments: Department[];
  doctors: Doctor[];
  patients: Patient[];
  visits: Visit[];
  payments: Payment[];
}

/** Column order used for CSV export / DuckDB COPY (must match the DDL). */
export const TABLE_COLUMNS = {
  branches: ['branch_id', 'branch_name', 'city_district', 'opened_date'],
  departments: ['department_id', 'department_name', 'specialty_group', 'base_price'],
  doctors: ['doctor_id', 'full_name', 'department_id', 'branch_id', 'seniority', 'hire_date', 'commission_rate'],
  patients: ['patient_id', 'registered_at', 'birth_year', 'gender', 'acquisition_channel', 'insurance_type', 'home_branch_id'],
  visits: [
    'visit_id', 'patient_id', 'doctor_id', 'department_id', 'branch_id', 'booking_created_at', 'scheduled_at',
    'confirmed_at', 'status', 'visit_type', 'billed_amount', 'discount', 'service_cost',
  ],
  payments: ['payment_id', 'visit_id', 'payment_date', 'paid_amount', 'method', 'status'],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;
/** Load order respects foreign keys. */
export const LOAD_ORDER: TableName[] = ['branches', 'departments', 'doctors', 'patients', 'visits', 'payments'];

// ─────────────────────────────────────────────────────────────────────────────
// Calendar constants
// ─────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
export const DATA_START = '2025-11-01';
export const DATA_END = '2026-10-31';
const START_MS = Date.UTC(2025, 10, 1);
const END_EXCL_MS = Date.UTC(2026, 10, 1);
// The network has existed for years, so the window must open on a mature
// patient base. We simulate a 15-month burn-in and only keep visits inside the
// window; patients acquired during burn-in appear as "legacy" patients with
// registered_at < 2025-11-01 (left-censored history — see cohort SQL).
const BURN_IN_START_MS = Date.UTC(2024, 7, 1);
const NUM_SIM_DAYS = Math.round((END_EXCL_MS - BURN_IN_START_MS) / DAY);

const DERM_OUTAGE_MS = Date.UTC(2026, 7, 1); // 2026-08-01
const RIVERSIDE_DROP_MS = Date.UTC(2026, 8, 1); // 2026-09-01
const PRICE_INDEX_MS = Date.UTC(2026, 3, 1); // 2026-04-01
const IG_CAMPAIGN_START = Date.UTC(2026, 5, 15); // 2026-06-15
const IG_CAMPAIGN_END = Date.UTC(2026, 7, 1); // 2026-08-01 (exclusive)

// ─────────────────────────────────────────────────────────────────────────────
// Seeded PRNG + sampling helpers
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  expo(mean: number): number {
    return -Math.log(Math.max(1 - this.next(), 1e-12)) * mean;
  }
  logNormal(sd: number): number {
    return Math.exp(this.normal(0, sd));
  }
  poisson(lambda: number): number {
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function fmtTs(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
const monthOf = (ms: number) => new Date(ms).getUTCMonth(); // 0 = Jan
const dowOf = (ms: number) => new Date(ms).getUTCDay(); // 0 = Sun
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ─────────────────────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────────────────────
const BRANCHES: Branch[] = [
  { branch_id: 1, branch_name: 'Central Campus', city_district: 'City Center', opened_date: '2017-03-01' },
  { branch_id: 2, branch_name: 'Northside', city_district: 'North District', opened_date: '2019-09-15' },
  { branch_id: 3, branch_name: 'Riverside', city_district: 'Riverside District', opened_date: '2022-05-10' },
];
const HOME_BRANCH_WEIGHTS = [0.42, 0.33, 0.25];

interface DeptProfile {
  dept: Department;
  share: number; // share of new-patient demand
  costRatio: number; // direct cost (consumables, rooms) as share of billed
  retention: number; // base probability of returning after a completed visit
  noShow: number; // base no-show probability for a confirmed booking
  followGap: number; // mean days to a same-department follow-up
  season: number[]; // demand multiplier by calendar month (0 = Jan)
}

const FLAT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const FLU = [1.45, 1.35, 1.1, 1, 0.95, 0.9, 0.8, 0.85, 1, 1.05, 1.15, 1.3];
const SUN = [0.85, 0.9, 1.05, 1.2, 1.35, 1.4, 1.25, 1.1, 1, 0.9, 0.85, 0.8];
const SKI = [1.15, 1.15, 1.05, 1, 1, 1, 1, 1, 1, 1, 1, 1.05];
const DENT = [1, 1, 1, 1, 1, 1, 0.95, 1, 1.05, 1, 1, 0.85];

const DEPTS: DeptProfile[] = [
  { dept: { department_id: 1, department_name: 'General Medicine', specialty_group: 'Primary Care', base_price: 55 }, share: 0.24, costRatio: 0.42, retention: 0.62, noShow: 0.07, followGap: 30, season: FLU },
  { dept: { department_id: 2, department_name: 'Pediatrics', specialty_group: 'Primary Care', base_price: 60 }, share: 0.14, costRatio: 0.4, retention: 0.66, noShow: 0.05, followGap: 35, season: FLU },
  { dept: { department_id: 3, department_name: 'Dermatology', specialty_group: 'Specialist', base_price: 95 }, share: 0.11, costRatio: 0.35, retention: 0.6, noShow: 0.08, followGap: 28, season: SUN },
  { dept: { department_id: 4, department_name: 'Cardiology', specialty_group: 'Specialist', base_price: 160 }, share: 0.09, costRatio: 0.48, retention: 0.74, noShow: 0.04, followGap: 45, season: FLAT },
  { dept: { department_id: 5, department_name: 'Orthopedics', specialty_group: 'Surgical', base_price: 140 }, share: 0.1, costRatio: 0.5, retention: 0.68, noShow: 0.05, followGap: 24, season: SKI },
  { dept: { department_id: 6, department_name: 'Dentistry', specialty_group: 'Surgical', base_price: 110 }, share: 0.16, costRatio: 0.45, retention: 0.7, noShow: 0.09, followGap: 21, season: DENT },
  { dept: { department_id: 7, department_name: 'Ophthalmology', specialty_group: 'Specialist', base_price: 100 }, share: 0.07, costRatio: 0.4, retention: 0.5, noShow: 0.06, followGap: 40, season: FLAT },
  { dept: { department_id: 8, department_name: 'Gynecology', specialty_group: 'Specialist', base_price: 90 }, share: 0.09, costRatio: 0.38, retention: 0.66, noShow: 0.06, followGap: 35, season: FLAT },
];
const PEDIATRICS = 2;
const DERMATOLOGY = 3;
const RIVERSIDE = 3;

const CHANNELS = ['Organic', 'Referral', 'Google Ads', 'Instagram', 'Insurance Partner'] as const;
const CHANNEL_WEIGHTS = [0.3, 0.18, 0.22, 0.15, 0.15];
const CHANNEL_RETENTION: Record<string, number> = {
  Organic: 1,
  Referral: 1.15,
  'Google Ads': 0.92,
  Instagram: 0.72,
  'Insurance Partner': 1.12,
};

// Demand multipliers
const ACQ_SEASON = [1.18, 1.12, 1.04, 0.98, 0.94, 0.88, 0.78, 0.8, 1.04, 1.08, 1.06, 0.96];
const RETURN_SEASON = [1.12, 1.1, 1.02, 0.98, 0.95, 0.9, 0.8, 0.82, 1.03, 1.05, 1.04, 0.9];
const BOOKING_DOW =[0.55, 1.25, 1.15, 1.1, 1.05, 0.95, 0.7]; // when bookings are *created*
const VISIT_DOW = [0.2, 1.15, 1.1, 1.05, 1.05, 0.95, 0.5]; // when visits are *scheduled*
const HOLIDAYS = new Set(['12-25', '01-01', '01-02']);

const FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Amelia', 'Oliver', 'Sophia', 'Elijah', 'Isabella', 'Lucas', 'Mia', 'Mateo',
  'Aisha', 'Daniyar', 'Elena', 'Marco', 'Priya', 'Kenji', 'Sara', 'Omar', 'Hannah', 'Felix', 'Leila', 'Arman',
  'Grace', 'Henry', 'Zoe', 'Samuel', 'Nora', 'David', 'Chloe', 'Ivan', 'Maya', 'Adrian', 'Lina', 'Victor',
];
const LAST_NAMES = [
  'Anderson', 'Bennett', 'Chen', 'Dawson', 'Ellis', 'Fischer', 'Garcia', 'Hughes', 'Ibrahim', 'Jensen', 'Kim',
  'Lopez', 'Morgan', 'Nakamura', 'Okafor', 'Patel', 'Quinn', 'Rossi', 'Sato', 'Turner', 'Ueda', 'Volkova',
  'Walker', 'Xu', 'Yilmaz', 'Zhang', 'Abenov', 'Brooks', 'Carter', 'Delgado', 'Evans', 'Foster',
];

// ─────────────────────────────────────────────────────────────────────────────
// Generator
// ─────────────────────────────────────────────────────────────────────────────
interface DraftVisit extends Omit<Visit, 'visit_id' | 'booking_created_at' | 'scheduled_at' | 'confirmed_at'> {
  createdMs: number;
  scheduledMs: number;
  confirmedMs: number | null;
  insurance: string;
}

export function generateDataset(seed = 42): Dataset {
  const rng = new Rng(seed);

  // ── Doctors: 2 per department per branch hired before the window, plus a
  //    few extra hires (some joining mid-year to model capacity growth).
  const doctors: Doctor[] = [];
  const usedNames = new Set<string>();
  const doctorName = () => {
    for (;;) {
      const n = `Dr. ${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };
  const addDoctor = (deptId: number, branchId: number, hireMs: number) => {
    const seniority = rng.weighted(['Junior', 'Mid', 'Senior'] as const, [0.3, 0.4, 0.3]);
    const base = seniority === 'Junior' ? 0.18 : seniority === 'Mid' ? 0.22 : 0.28;
    doctors.push({
      doctor_id: doctors.length + 1,
      full_name: doctorName(),
      department_id: deptId,
      branch_id: branchId,
      seniority,
      hire_date: fmtDate(hireMs),
      commission_rate: round2(base + rng.uniform(-0.015, 0.015)),
    });
  };
  for (const { dept } of DEPTS) {
    for (const b of BRANCHES) {
      const opened = Date.parse(b.opened_date);
      for (let i = 0; i < 2; i++) {
        addDoctor(dept.department_id, b.branch_id, opened + rng.int(0, Math.floor((BURN_IN_START_MS - opened) / DAY) - 30) * DAY);
      }
    }
  }
  // Extra capacity at the flagship + mid-year hires.
  for (const deptId of [1, 2, 6]) addDoctor(deptId, 1, Date.UTC(2021, rng.int(0, 11), rng.int(1, 28)));
  addDoctor(4, 2, Date.UTC(2026, 2, 2)); // Cardiology @ Northside joins Mar 2026
  addDoctor(3, 1, Date.UTC(2026, 4, 4)); // Dermatology @ Central joins May 2026
  addDoctor(5, 3, Date.UTC(2026, 0, 12)); // Orthopedics @ Riverside joins Jan 2026

  const doctorsByDeptBranch = new Map<string, Doctor[]>();
  for (const d of doctors) {
    const key = `${d.department_id}:${d.branch_id}`;
    if (!doctorsByDeptBranch.has(key)) doctorsByDeptBranch.set(key, []);
    doctorsByDeptBranch.get(key)!.push(d);
  }
  const SENIORITY_POP = { Junior: 0.75, Mid: 1, Senior: 1.4 };
  const SENIORITY_PRICE = { Junior: 0.85, Mid: 1, Senior: 1.3 };
  const doctorById = new Map(doctors.map((d) => [d.doctor_id, d]));

  const pickDoctor = (deptId: number, branchId: number, atMs: number): Doctor => {
    const pool = doctorsByDeptBranch.get(`${deptId}:${branchId}`)!.filter((d) => Date.parse(d.hire_date) <= atMs);
    return rng.weighted(pool, pool.map((d) => SENIORITY_POP[d.seniority]));
  };

  // ── Department choice depends on age and seasonality of the target month.
  const pickDept = (age: number, atMs: number): DeptProfile => {
    const m = monthOf(atMs);
    if (age < 16) {
      return rng.chance(0.8) ? DEPTS[PEDIATRICS - 1] : rng.pick([DEPTS[5], DEPTS[6], DEPTS[2]]);
    }
    const pool = DEPTS.filter((d) => d.dept.department_id !== PEDIATRICS);
    return rng.weighted(pool, pool.map((d) => d.share * d.season[m]));
  };

  // ── Pick the actual appointment day within a week of the desired day,
  //    weighted by weekday capacity (weekends/holidays are thin) and by
  //    closeness to the desired day. Sampling — rather than "push forward
  //    until accepted" — avoids piling every rejected day onto Mondays.
  const scheduleDay = (candidateDayMs: number): number => {
    const days: number[] = [];
    const weights: number[] = [];
    for (let k = 0; k < 7; k++) {
      const day = candidateDayMs + k * DAY;
      const holiday = HOLIDAYS.has(fmtDate(day).slice(5)) ? 0.05 : 1;
      days.push(day);
      weights.push(VISIT_DOW[dowOf(day)] * holiday * Math.pow(0.6, k));
    }
    return rng.weighted(days, weights);
  };
  const slotTime = (dayMs: number): number => {
    const weekend = dowOf(dayMs) === 0 || dowOf(dayMs) === 6;
    const hours = weekend ? [9, 10, 11, 12, 13] : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const weights = weekend ? [1, 1.2, 1.2, 1, 0.7] : [0.7, 1.2, 1.3, 1.2, 0.9, 0.7, 0.8, 0.9, 1, 1.2, 1.1, 0.6];
    return dayMs + rng.weighted(hours, weights) * HOUR + (rng.chance(0.5) ? 30 : 0) * MINUTE;
  };
  const sampleLead = (): number => {
    const r = rng.float();
    if (r < 0.22) return 0;
    if (r < 0.62) return rng.int(1, 3);
    return rng.int(4, 14);
  };

  const patients: Patient[] = [];
  const drafts: DraftVisit[] = [];

  // Simulates one booking and its outcome. Returns the draft visit.
  const book = (
    p: Patient,
    age: number,
    profile: DeptProfile,
    branchId: number,
    createdMs: number,
    scheduledMs: number,
    doctor: Doctor,
    visitType: 'initial' | 'follow_up',
    isFirstBooking: boolean,
  ): DraftVisit => {
    const deptId = profile.dept.department_id;
    const leadDays = Math.round((dayStart(scheduledMs) - dayStart(createdMs)) / DAY);
    const dermOutage = deptId === DERMATOLOGY && scheduledMs >= DERM_OUTAGE_MS;
    const riversideDrop = branchId === RIVERSIDE && scheduledMs >= RIVERSIDE_DROP_MS;

    // Step 1 — confirmation (call-center / SMS)
    let pConfirm = leadDays === 0 ? 0.98 : 0.91;
    if (riversideDrop) pConfirm = leadDays === 0 ? 0.9 : 0.64;
    if (dermOutage) pConfirm = Math.min(pConfirm, 0.76);
    if (isFirstBooking && p.acquisition_channel === 'Instagram') pConfirm -= 0.05;
    const confirmed = rng.chance(pConfirm);

    let confirmedMs: number | null = null;
    if (confirmed) {
      const window = Math.max(scheduledMs - createdMs - HOUR, 10 * MINUTE);
      confirmedMs = createdMs + Math.min(window, leadDays === 0 ? rng.int(5, 30) * MINUTE : rng.uniform(0.2, 48) * HOUR);
    }

    // Step 2 — attendance
    let status: Visit['status'];
    if (confirmed) {
      let pNoShow = profile.noShow;
      if (leadDays >= 8) pNoShow += 0.04;
      if (age >= 18 && age <= 30) pNoShow += 0.03;
      if (p.acquisition_channel === 'Instagram') pNoShow += 0.03;
      if (dermOutage) pNoShow += 0.2; // no reminders → patients forget
      const r = rng.float();
      status = r < pNoShow ? 'no_show' : r < pNoShow + 0.04 ? 'cancelled' : 'completed';
    } else {
      status = rng.weighted(['cancelled', 'no_show', 'completed'] as const, [0.25, 0.3, 0.45]);
    }

    // Pricing (quoted at booking; only completed visits incur cost)
    const doc = doctorById.get(doctor.doctor_id)!;
    const priceIndex = scheduledMs >= PRICE_INDEX_MS ? 1.06 : 1;
    const typeMult = visitType === 'initial' ? 1.15 : 0.85;
    const billed = Math.max(
      20,
      Math.round(profile.dept.base_price * SENIORITY_PRICE[doc.seniority] * typeMult * priceIndex * rng.logNormal(0.12)),
    );
    let discountPct = 0;
    if (isFirstBooking && p.acquisition_channel === 'Instagram') discountPct = 0.15;
    else if (p.acquisition_channel === 'Insurance Partner') discountPct = 0.1;
    else if (visitType === 'follow_up' && rng.chance(0.08)) discountPct = 0.05;
    const m = monthOf(scheduledMs);
    if (deptId === DERMATOLOGY && (m === 5 || m === 6) && rng.chance(0.3)) discountPct = Math.max(discountPct, 0.2);
    const discount = round2(billed * discountPct);
    const serviceCost = status === 'completed' ? round2(billed * profile.costRatio * rng.logNormal(0.08)) : 0;

    return {
      patient_id: p.patient_id,
      doctor_id: doctor.doctor_id,
      department_id: deptId,
      branch_id: branchId,
      createdMs,
      scheduledMs,
      confirmedMs,
      status,
      visit_type: visitType,
      billed_amount: billed,
      discount,
      service_cost: serviceCost,
      insurance: p.insurance_type,
    };
  };

  // ── Patient acquisition loop: day by day, Poisson arrivals.
  const BASE_NEW_PER_DAY = 29;
  for (let d = 0; d < NUM_SIM_DAYS; d++) {
    const dayMs = BURN_IN_START_MS + d * DAY;
    const monthsIn = (dayMs - START_MS) / DAY / 30.4; // negative during burn-in
    const growth = Math.max(0.7, 1 + 0.018 * monthsIn);
    const holiday = HOLIDAYS.has(fmtDate(dayMs).slice(5)) ? 0.3 : 1;
    const lambda = BASE_NEW_PER_DAY * ACQ_SEASON[monthOf(dayMs)] * growth * BOOKING_DOW[dowOf(dayMs)] * holiday;
    let arrivals = rng.poisson(lambda);
    const igCampaign = dayMs >= IG_CAMPAIGN_START && dayMs < IG_CAMPAIGN_END;
    const campaignArrivals = igCampaign ? rng.poisson(lambda * 0.35) : 0;
    arrivals += campaignArrivals;

    for (let a = 0; a < arrivals; a++) {
      const fromCampaign = a >= arrivals - campaignArrivals;
      const age = rng.chance(0.18) ? rng.int(0, 15) : Math.round(clamp(rng.normal(44, 16), 16, 88));
      const channel = fromCampaign ? 'Instagram' : rng.weighted(CHANNELS, CHANNEL_WEIGHTS);
      const insurance =
        channel === 'Insurance Partner' ? 'Corporate' : rng.chance(0.25) ? 'Private Insurance' : 'Self-pay';
      const p: Patient = {
        patient_id: patients.length + 1,
        registered_at: fmtDate(dayMs),
        birth_year: 2026 - age,
        gender: rng.chance(0.54) ? 'F' : 'M',
        acquisition_channel: channel,
        insurance_type: insurance,
        home_branch_id: rng.weighted([1, 2, 3], HOME_BRANCH_WEIGHTS),
      };
      patients.push(p);
      simulatePatientJourney(p, age, dayMs);
    }
  }

  function simulatePatientJourney(p: Patient, age: number, acquisitionDayMs: number) {
    let profile = pickDept(age, acquisitionDayMs);
    let createdMs = acquisitionDayMs + rng.int(7, 22) * HOUR + rng.int(0, 59) * MINUTE;
    let lead = sampleLead();
    let completedCount = 0;
    let lastDoctorByDept = new Map<number, Doctor>();
    const seenDepts = new Set<number>();
    let isFirst = true;

    for (let n = 0; n < 30; n++) {
      // Decide schedule day / time
      const schedDay = scheduleDay(dayStart(createdMs) + lead * DAY);
      if (schedDay >= END_EXCL_MS) return; // booking falls outside the observed window
      let scheduledMs = slotTime(schedDay);
      if (scheduledMs <= createdMs + HOUR) {
        // same-day booking: push slot after creation time, or move creation earlier
        createdMs = scheduledMs - rng.int(70, 240) * MINUTE;
      }
      const branchId = rng.chance(0.85) ? p.home_branch_id : rng.weighted([1, 2, 3], HOME_BRANCH_WEIGHTS);
      const deptId = profile.dept.department_id;
      const prevDoc = lastDoctorByDept.get(deptId);
      const doctor =
        prevDoc && prevDoc.branch_id === branchId && rng.chance(0.75) ? prevDoc : pickDoctor(deptId, branchId, scheduledMs);
      const visitType = seenDepts.has(deptId) ? 'follow_up' : 'initial';

      const v = book(p, age, profile, branchId, createdMs, scheduledMs, doctor, visitType, isFirst);
      drafts.push(v);
      isFirst = false;

      // Decide what happens next
      let nextScheduledTarget: number;
      if (v.status === 'completed') {
        completedCount++;
        seenDepts.add(deptId);
        lastDoctorByDept.set(deptId, doctor);
        const pReturn = clamp(
          profile.retention * CHANNEL_RETENTION[p.acquisition_channel] * Math.pow(0.95, completedCount - 1),
          0,
          0.93,
        );
        const r = rng.float();
        let nextProfile = profile;
        if (r < 0.6) {
          nextScheduledTarget = scheduledMs + (10 + rng.expo(profile.followGap)) * DAY;
        } else if (r < 0.85) {
          nextScheduledTarget = scheduledMs + (15 + rng.expo(55)) * DAY;
          nextProfile = pickDept(age, nextScheduledTarget);
        } else {
          nextScheduledTarget = scheduledMs + (80 + rng.expo(20)) * DAY; // periodic check-up
        }
        // Fewer people come back during summer holidays / late December.
        if (!rng.chance(clamp(pReturn * RETURN_SEASON[monthOf(nextScheduledTarget)], 0, 0.95))) return; // churned
        profile = nextProfile;
      } else {
        const pRebook = v.status === 'cancelled' ? 0.6 : 0.45;
        if (!rng.chance(pRebook)) return;
        nextScheduledTarget = scheduledMs + (2 + rng.expo(7)) * DAY;
      }

      // Patients book ahead: creation = target - lead, never before the last visit.
      lead = sampleLead();
      const lastVisitDay = dayStart(scheduledMs);
      const targetDay = dayStart(nextScheduledTarget);
      const createdDay = Math.max(lastVisitDay, targetDay - lead * DAY);
      lead = Math.round((targetDay - createdDay) / DAY);
      createdMs = createdDay + (createdDay === lastVisitDay ? 20 : rng.int(7, 22)) * HOUR + rng.int(0, 59) * MINUTE;
      if (createdDay === lastVisitDay && createdMs < scheduledMs) createdMs = scheduledMs + rng.int(30, 90) * MINUTE;
    }
  }

  // ── Keep only appointments inside the observation window, then assign
  //    visit IDs in booking-creation order (like an auto-increment PK).
  const inWindow = drafts.filter((v) => v.scheduledMs >= START_MS);
  inWindow.sort((a, b) => a.createdMs - b.createdMs || a.patient_id - b.patient_id);
  drafts.length = 0;
  drafts.push(...inWindow);
  const visits: Visit[] = drafts.map((v, i) => ({
    visit_id: i + 1,
    patient_id: v.patient_id,
    doctor_id: v.doctor_id,
    department_id: v.department_id,
    branch_id: v.branch_id,
    booking_created_at: fmtTs(v.createdMs),
    scheduled_at: fmtTs(v.scheduledMs),
    confirmed_at: v.confirmedMs === null ? null : fmtTs(v.confirmedMs),
    status: v.status,
    visit_type: v.visit_type,
    billed_amount: v.billed_amount,
    discount: v.discount,
    service_cost: v.service_cost,
  }));

  // ── Payments: one settlement row per completed visit (+ refund rows).
  type DraftPayment = Omit<Payment, 'payment_id'> & { sortMs: number };
  const draftPayments: DraftPayment[] = [];
  drafts.forEach((v, i) => {
    if (v.status !== 'completed') return;
    const visitId = i + 1;
    const net = round2(v.billed_amount - v.discount);
    const visitDay = dayStart(v.scheduledMs);
    const insured = v.insurance !== 'Self-pay' && rng.chance(0.85);
    if (insured) {
      const settleMs = visitDay + rng.int(12, 47) * DAY;
      if (settleMs >= END_EXCL_MS) {
        draftPayments.push({ visit_id: visitId, payment_date: null, paid_amount: 0, method: 'insurance', status: 'pending', sortMs: Infinity });
      } else if (rng.chance(0.04)) {
        draftPayments.push({ visit_id: visitId, payment_date: fmtDate(settleMs), paid_amount: 0, method: 'insurance', status: 'denied', sortMs: settleMs });
      } else if (rng.chance(0.06)) {
        draftPayments.push({ visit_id: visitId, payment_date: fmtDate(settleMs), paid_amount: round2(net * rng.uniform(0.7, 0.9)), method: 'insurance', status: 'partial', sortMs: settleMs });
      } else {
        draftPayments.push({ visit_id: visitId, payment_date: fmtDate(settleMs), paid_amount: net, method: 'insurance', status: 'paid', sortMs: settleMs });
      }
      return;
    }
    const method = rng.chance(0.78) ? 'card' : 'cash';
    const partial = rng.chance(0.02);
    draftPayments.push({
      visit_id: visitId,
      payment_date: fmtDate(visitDay),
      paid_amount: partial ? round2(net * rng.uniform(0.5, 0.9)) : net,
      method,
      status: partial ? 'partial' : 'paid',
      sortMs: v.scheduledMs,
    });
    if (method === 'card' && !partial && rng.chance(0.012)) {
      const refundMs = visitDay + rng.int(2, 15) * DAY;
      if (refundMs < END_EXCL_MS) {
        draftPayments.push({ visit_id: visitId, payment_date: fmtDate(refundMs), paid_amount: -net, method, status: 'refunded', sortMs: refundMs });
      }
    }
  });
  draftPayments.sort((a, b) => a.sortMs - b.sortMs || a.visit_id - b.visit_id);
  const payments: Payment[] = draftPayments.map(({ sortMs: _s, ...p }, i) => ({ payment_id: i + 1, ...p }));

  return {
    branches: BRANCHES.map((b) => ({ ...b })),
    departments: DEPTS.map((d) => ({ ...d.dept })),
    doctors,
    patients,
    visits,
    payments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV serialization (used for DuckDB bulk load and `npm run data:export`)
// ─────────────────────────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: TableName, rows: readonly object[]): string {
  const cols = TABLE_COLUMNS[table] as readonly string[];
  const lines = [cols.join(',')];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(cols.map((c) => csvCell(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}
