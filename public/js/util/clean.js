/**
 * Turning whatever arrived into something safe to store.
 *
 * Imported by both halves of the app — the browser uses these when it keeps
 * recipes on the device, the Worker uses them when it keeps them in a database.
 * One copy means a recipe typed in offline and one saved to a server are
 * cleaned the same way, and can't drift apart.
 */

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Trim, collapse whitespace, and treat empty as null. Used on every text field. */
export function str(value, max = 2000) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Same as str() but keeps line breaks, for notes and step text. */
export function text(value, max = 8000) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function num(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function int(value, opts) {
  const n = num(value, opts);
  return n === null ? null : Math.round(n);
}

/**
 * A link we're willing to render as an href later.
 *
 * Anything that isn't http(s) becomes null — `javascript:` in a source URL
 * would otherwise run when someone taps "From <site>" on the recipe.
 */
export function safeUrl(value, max = 1000) {
  const s = str(value, max);
  if (!s) return null;
  try {
    const url = new URL(s);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? s : null;
  } catch {
    return null;
  }
}
