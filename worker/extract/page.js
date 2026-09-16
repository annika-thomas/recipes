/**
 * Fetching a page, and getting the words out of it.
 *
 * The browser can't do this — a recipe site will not send CORS headers to a
 * random web app — which is the whole reason the app has a server at all. Here
 * we fetch it, strip it down to readable text, and hand that to Claude if the
 * structured-data path didn't already win.
 */

import { HttpError } from '../lib/http.js';
import { stripTags, decodeEntities } from './jsonld.js';

/** A real browser UA: a few sites serve a blank shell to anything else. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MAX_BYTES = 3_000_000;

export function parseUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a link.");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'Only http and https links can be imported.');
  }
  // Don't let a pasted link turn the Worker into a probe of private networks.
  const host = url.hostname.toLowerCase();
  const blocked = host === 'localhost' || host.endsWith('.local')
    || /^(?:127|10|0|169\.254)\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    || host === '[::1]';
  if (blocked) throw new HttpError(400, 'That link points somewhere private.');

  return url;
}

export async function fetchPage(url) {
  let response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 300, cacheEverything: true },
    });
  } catch (err) {
    throw new HttpError(502, `Couldn't reach that site (${err?.message || 'network error'}).`);
  }

  if (response.status === 404) throw new HttpError(404, 'That page is gone (404).');
  if (response.status === 403 || response.status === 401) {
    throw new HttpError(422, "That site won't let us read it. Try a screenshot of the recipe instead.");
  }
  if (!response.ok) throw new HttpError(502, `That site returned ${response.status}.`);

  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
    throw new HttpError(415, 'That link is not a web page.');
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new HttpError(413, 'That page is enormous. Try a screenshot instead.');
  }

  return {
    html: new TextDecoder('utf-8', { fatal: false }).decode(buffer),
    finalUrl: response.url || url.toString(),
  };
}

/** Grab an OpenGraph / twitter / name meta tag, whichever the page used. */
export function meta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

export function pageTitle(html) {
  return meta(html, 'og:title')
    || stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
    || null;
}

export function siteName(html, url) {
  return meta(html, 'og:site_name') || url.hostname.replace(/^www\./, '');
}

/**
 * Reduce a page to the text a person would actually read.
 *
 * This is not a full readability implementation and doesn't need to be: Claude
 * copes fine with some navigation cruft, it just can't cope with 400KB of
 * minified script. So: drop the things that are definitely not prose, strip the
 * tags, and keep the paragraph breaks that tell steps apart.
 */
export function readableText(html) {
  let s = html;

  for (const tag of ['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'footer', 'header', 'form']) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Keep block boundaries as newlines so ingredient lists don't run together.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');

  s = decodeEntities(s.replace(/<[^>]*>/g, ' '));
  s = s.replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .trim();

  return s;
}
