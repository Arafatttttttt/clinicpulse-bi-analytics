/**
 * Color assignment helpers.
 *
 * Categorical: fixed slot order (CVD-validated), keyed by the ENTITY id so a
 * department keeps its color no matter which filters are active.
 * Sequential: single-hue blue ramp; the dark-mode ramp is selected separately
 * so that "near zero" recedes toward the dark surface instead of glowing.
 */
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

export const seriesColor = (entityId: number) => SERIES[(entityId - 1) % SERIES.length];

const RAMP_LIGHT = ['#e3eefc', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const RAMP_DARK = ['#18222e', '#162c47', '#183a63', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

/** t ∈ [0,1] → background + readable text color for a heatmap cell. */
export function sequential(t: number, theme: 'light' | 'dark'): { bg: string; fg: string } {
  const ramp = theme === 'dark' ? RAMP_DARK : RAMP_LIGHT;
  const x = Math.min(1, Math.max(0, t));
  const i = Math.round(x * (ramp.length - 1));
  const strong = theme === 'dark' ? i >= 9 : i >= 7;
  return { bg: ramp[i], fg: strong ? (theme === 'dark' ? '#0b0b0b' : '#ffffff') : theme === 'dark' ? '#f0efec' : '#0b0b0b' };
}

/** Diverging tint for a gap vs. benchmark (negative = worse = red). */
export function divergingTint(gap: number | null, theme: 'light' | 'dark', fullScale = 0.15): string {
  if (gap === null || Number.isNaN(gap)) return 'transparent';
  const a = Math.min(Math.abs(gap) / fullScale, 1) * (theme === 'dark' ? 0.5 : 0.38);
  if (Math.abs(gap) < 0.005) return 'transparent';
  return gap < 0 ? `rgba(227, 73, 72, ${a.toFixed(3)})` : `rgba(42, 120, 214, ${a.toFixed(3)})`;
}
