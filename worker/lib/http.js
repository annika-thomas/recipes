/** Small helpers so every route returns the same shapes. */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

/** Thrown by routes to produce a clean error response instead of a 500. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function badRequest(message, extra) { return new HttpError(400, message, extra); }

/** Body parsing that fails loudly rather than handing routes `undefined`. */
export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    throw badRequest('That request body was not valid JSON.');
  }
}

export function nowIso() { return new Date().toISOString(); }

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

/**
 * A link we're willing to render as an href later.
 *
 * Anything that isn't http(s) becomes null — `javascript:` in a source URL
 * would otherwise run when someone taps "From <site>" on the recipe. Imports
 * already go through parseUrl, but the editor and the API can set this field
 * directly, so the check belongs here where every write passes through.
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
