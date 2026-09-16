/**
 * Making the passcode worth something on a public URL.
 *
 * The app is one shared passcode behind a link, which is the right amount of
 * friction for two people — but only if guessing is slow. Cloudflare's free
 * tier doesn't rate-limit a single endpoint for you, so without this an
 * attacker who gets the URL can try passcodes as fast as the network allows,
 * and a memorable passcode falls in minutes.
 *
 * Ten wrong guesses from one address inside fifteen minutes locks that address
 * out for fifteen. That's unlimited typos in practice — nobody gets their own
 * passcode wrong ten times in a quarter of an hour — and it takes brute force
 * from minutes to centuries.
 */

import { HttpError, nowIso } from './http.js';

const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

/**
 * Who is asking. Cloudflare sets cf-connecting-ip on every real request and it
 * can't be spoofed by the client — an inbound header of that name is replaced
 * at the edge. Locally there's no such header, so every attempt shares one
 * bucket, which is fine: nobody is brute-forcing your laptop.
 */
function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}

function minutesUntil(iso) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

/** Throws when this address is locked out. Call before checking the passcode. */
export async function assertNotLockedOut(request, env) {
  const ip = clientIp(request);

  const row = await env.DB.prepare('SELECT locked_until FROM login_attempts WHERE ip = ?')
    .bind(ip).first();

  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new HttpError(429,
      `Too many wrong passcodes. Try again in ${minutesUntil(row.locked_until)} minutes.`);
  }
  return ip;
}

/** Record a wrong passcode, and start a lockout once there have been enough. */
export async function recordFailure(env, ip) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT fails, window_start FROM login_attempts WHERE ip = ?')
    .bind(ip).first();

  // A gap longer than the window means this is a fresh run of attempts, not a
  // continuation of one from an hour ago.
  const windowLapsed = !row || (now - new Date(row.window_start).getTime()) > WINDOW_MS;
  const fails = windowLapsed ? 1 : row.fails + 1;
  const windowStart = windowLapsed ? nowIso() : row.window_start;
  const lockedUntil = fails >= MAX_FAILS ? new Date(now + LOCKOUT_MS).toISOString() : null;

  await env.DB.prepare(`
    INSERT INTO login_attempts (ip, fails, window_start, locked_until) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (ip) DO UPDATE SET fails = ?2, window_start = ?3, locked_until = ?4
  `).bind(ip, fails, windowStart, lockedUntil).run();

  if (lockedUntil) {
    throw new HttpError(429,
      `Too many wrong passcodes. Try again in ${minutesUntil(lockedUntil)} minutes.`);
  }
}

/** Getting it right wipes the slate. */
export async function clearFailures(env, ip) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
