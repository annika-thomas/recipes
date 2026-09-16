/** Small helpers so every route returns the same shapes. */

// Field cleaning is shared with the browser so both storage paths agree.
export { nowIso, newId, str, text, num, int, safeUrl } from '../../public/js/util/clean.js';

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
