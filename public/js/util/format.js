/**
 * Dates and quantities, formatted the way a person in a kitchen reads them.
 *
 * Two rules drive everything here. Dates are *local* — a cook logged at 11pm on
 * the 3rd belongs to the 3rd, and `toISOString()` would file it under the 4th
 * for anyone west of Greenwich. And quantities come back as fractions, because
 * "0.33 cup" is not a thing anybody measures.
 */

/* --------------------------------------------------------------- dates --- */

export function todayKey() {
  return dateKey(new Date());
}

/** YYYY-MM-DD in the phone's own timezone. */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD back to a local-midnight Date (never UTC midnight). */
export function fromKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthName(index) { return MONTHS[index]; }
export const DOW_SHORT = DOW;

export function formatDate(key, { weekday = false } = {}) {
  const date = fromKey(key);
  const month = MONTHS[date.getMonth()].slice(0, 3);
  const base = `${month} ${date.getDate()}`;
  const withYear = date.getFullYear() === new Date().getFullYear()
    ? base : `${base}, ${date.getFullYear()}`;
  return weekday ? `${DOW[date.getDay()]} ${withYear}` : withYear;
}

/** "Today", "Yesterday", "3 days ago", then a date. */
export function relativeDate(key) {
  if (!key) return null;
  const days = Math.round((fromKey(todayKey()) - fromKey(key)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return formatDate(key);
}

/* ---------------------------------------------------------------- times --- */

export function formatMinutes(mins) {
  if (!mins && mins !== 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ------------------------------------------------------------ quantities --- */

const FRACTIONS = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

/**
 * 0.5 -> ½, 1.25 -> 1¼, 2.4 -> 2.4 (no nearby fraction, so leave it decimal).
 * Tolerance is deliberately tight: rounding 0.4 to ⅜ would be a lie about a
 * measurement, and scaling a recipe by 1.5 is exactly when that matters.
 */
export function formatQty(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value === 0) return '0';

  const whole = Math.floor(value);
  const rest = value - whole;

  if (rest < 0.02) return String(whole);

  for (const [fraction, glyph] of FRACTIONS) {
    if (Math.abs(rest - fraction) < 0.02) {
      return whole ? `${whole}${glyph}` : glyph;
    }
  }

  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/** The "2 tbsp" half of an ingredient line, scaled. */
export function formatAmount(ingredient, scale = 1) {
  const qty = ingredient.qty === null || ingredient.qty === undefined
    ? null : formatQty(ingredient.qty * scale);
  return [qty, ingredient.unit].filter(Boolean).join(' ');
}

/** "4 servings", "12 cookies". */
export function formatYield(recipe, scale = 1) {
  if (!recipe.servings) return null;
  const n = formatQty(recipe.servings * scale);
  const unit = recipe.servingsUnit || 'servings';
  return `${n} ${n === '1' ? unit.replace(/s$/, '') : unit}`;
}

export function pluralise(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
