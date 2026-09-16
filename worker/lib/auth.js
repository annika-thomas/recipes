/**
 * One passcode, two people.
 *
 * There are no accounts here. You both type the same household passcode once,
 * and pick a name so the app can tell your ratings apart. What's stored on the
 * phone afterwards is a cookie signed with SESSION_SECRET — the passcode itself
 * never goes back to the browser, and the cookie can't be forged without the
 * secret.
 */

import { HttpError } from './http.js';

const COOKIE = 'kitchen_session';
const TTL_DAYS = 400; // effectively "stay logged in"; Safari caps cookies here anyway

const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sign(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64url(mac)}`;
}

async function verify(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(mac), enc.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Compare in constant time. Overkill for a household passcode, but a timing
 * side-channel is the kind of thing that's free to close and annoying to explain.
 */
function sameSecret(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Is this a `wrangler dev` session on this machine?
 *
 * It decides two things: which half of the setup instructions to quote when a
 * secret is missing, and whether the cookie is marked Secure. Safari drops a
 * Secure cookie sent over plain http, which would make signing in on localhost
 * silently fail to stick — so on a local origin we leave the flag off and set
 * it everywhere else.
 */
export function isLocal(request) {
  const { hostname, protocol } = new URL(request.url);
  return protocol === 'http:'
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
}

function cookieParts(local) {
  return ['Path=/', 'HttpOnly', local ? null : 'Secure', 'SameSite=Lax'].filter(Boolean);
}

/** Sign in with the household passcode. Returns the Set-Cookie header value. */
export async function signIn(env, passcode, person, { local = false } = {}) {
  const missing = (name) => new HttpError(500, local
    ? `This kitchen has no ${name} yet. Run \`npm run setup\`, or add ${name} to the .dev.vars file yourself.`
    : `This kitchen has no ${name} yet. Run: npx wrangler secret put ${name}`);

  if (!env.HOUSEHOLD_PASSCODE) throw missing('HOUSEHOLD_PASSCODE');
  if (!env.SESSION_SECRET) throw missing('SESSION_SECRET');

  if (!sameSecret(passcode || '', env.HOUSEHOLD_PASSCODE)) {
    throw new HttpError(401, "That passcode doesn't match.");
  }

  const name = String(person || '').trim().slice(0, 40) || 'someone';
  const exp = Date.now() + TTL_DAYS * 86400_000;
  const token = await sign({ person: name, exp }, env.SESSION_SECRET);

  return {
    person: name,
    cookie: [
      `${COOKIE}=${encodeURIComponent(token)}`,
      ...cookieParts(local),
      `Max-Age=${TTL_DAYS * 86400}`,
    ].join('; '),
  };
}

export function signOutCookie(local = false) {
  return [`${COOKIE}=`, ...cookieParts(local), 'Max-Age=0'].join('; ');
}

/** Who is making this request? Null when signed out. */
export async function currentPerson(request, env) {
  if (!env.SESSION_SECRET) return null;
  const payload = await verify(readCookie(request, COOKIE), env.SESSION_SECRET);
  return payload?.person || null;
}

/** Same, but refuses the request instead of returning null. */
export async function requirePerson(request, env) {
  const person = await currentPerson(request, env);
  if (!person) throw new HttpError(401, 'Sign in to this kitchen first.', { needsAuth: true });
  return person;
}
