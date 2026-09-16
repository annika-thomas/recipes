/**
 * Recipe photos, in R2.
 *
 * Two ways in: the phone uploads one, or we save the hero image off a page we
 * imported. Either way the key is random, the type is checked, and the object
 * is served back with a long cache since keys are never reused.
 */

import { json, newId, HttpError } from '../lib/http.js';

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

const MAX_BYTES = 12_000_000;

export function extensionFor(mediaType) {
  return ALLOWED[String(mediaType || '').toLowerCase().split(';')[0].trim()] || null;
}

export async function storeImage(env, bytes, mediaType) {
  const ext = extensionFor(mediaType);
  if (!ext) throw new HttpError(415, 'That file type is not an image we can store.');
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'That photo is too large — 12MB is the ceiling.');

  const key = `${newId('img').slice(4)}.${ext}`;
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: mediaType, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return key;
}

/** POST /api/images — multipart upload straight from the camera roll. */
export async function uploadImage(request, env) {
  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  if (!file || typeof file === 'string') throw new HttpError(400, 'No image came through.');

  const bytes = await file.arrayBuffer();
  const key = await storeImage(env, bytes, file.type);
  return json({ key, url: `/img/${key}` });
}

/** Save a page's own hero image so the card still has a picture offline. */
export async function storeRemoteImage(env, imageUrl) {
  try {
    const res = await fetch(imageUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Kitchen/1.0)' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;

    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!extensionFor(type)) return null;

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return null;

    return await storeImage(env, bytes, type);
  } catch {
    // A missing picture is never worth failing an import over.
    return null;
  }
}

/** GET /img/:key */
export async function serveImage(env, key) {
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
