/**
 * Getting a recipe in.
 *
 * Four doors, one room. Photos and pasted text go straight to Claude; a link
 * is sniffed first, because the cheapest, most accurate import is the one where
 * the site already told us the recipe in machine-readable form and we didn't
 * have to ask a model anything.
 *
 * Nothing here saves. Every endpoint returns a *draft* the app shows you for
 * review — importing is a guess, and a guess you didn't look at is how you end
 * up cooking from a recipe missing its oven temperature.
 */

import { json, readJson, str, text, HttpError } from '../lib/http.js';
import { normaliseRecipe, coerceCategory } from '../lib/recipeSchema.js';
import { recipeFromImages, recipeFromText } from '../lib/claude.js';
import { recipeFromJsonLd } from '../extract/jsonld.js';
import { fetchPage, parseUrl, pageTitle, siteName, readableText, meta } from '../extract/page.js';
import { fetchSocialPost, socialPlatform, captionLooksThin } from '../extract/social.js';
import { storeImage, storeRemoteImage, extensionFor } from './images.js';

/** Wrap whatever an extractor produced into the draft shape the app expects. */
function draft(parsed, { sourceType, sourceUrl, sourceName, imageKey, warning }) {
  const recipe = normaliseRecipe(parsed);
  return json({
    draft: {
      ...recipe,
      category: coerceCategory(parsed.category || recipe.category),
      sourceType,
      sourceUrl: sourceUrl || null,
      sourceName: sourceName || null,
      imageKey: imageKey || null,
      image: imageKey ? `/img/${imageKey}` : null,
    },
    confident: parsed.confident !== false,
    warning: warning || null,
  });
}

/* ---------------------------------------------------------------- photos --- */

/**
 * POST /api/import/photo  (multipart: image, image, …, hint)
 *
 * Several images are read as one recipe in order, which is how a cookbook
 * spread or a recipe that ran over two screenshots actually arrives.
 */
export async function importPhoto(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'That upload was malformed.');

  const files = form.getAll('image').filter((f) => typeof f !== 'string');
  if (!files.length) throw new HttpError(400, 'No photo came through.');
  if (files.length > 6) throw new HttpError(400, 'Six photos is the most we can read as one recipe.');

  const hint = str(form.get('hint'), 300);
  const images = [];
  let firstKey = null;

  for (const file of files) {
    const mediaType = (file.type || '').split(';')[0].trim();
    if (!extensionFor(mediaType)) {
      throw new HttpError(415, `${file.name || 'That file'} is not an image we can read.`);
    }
    // HEIC is what an iPhone shoots by default, and the API can't read it.
    // The app converts to JPEG before uploading; this is belt and braces.
    if (mediaType === 'image/heic' || mediaType === 'image/heif') {
      throw new HttpError(415, "That photo is in Apple's HEIC format, which we can't read. Screenshot it, or set Settings → Camera → Formats → Most Compatible.");
    }

    const bytes = await file.arrayBuffer();
    const key = await storeImage(env, bytes, mediaType);
    if (!firstKey) firstKey = key;

    images.push({ mediaType, base64: toBase64(bytes) });
  }

  const parsed = await recipeFromImages(env, images, hint);

  return draft(parsed, {
    sourceType: 'photo',
    imageKey: firstKey,
    sourceName: hint || null,
    warning: parsed.confident === false
      ? "Some of that photo didn't read cleanly — worth checking against the original."
      : null,
  });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: spreading a megabyte-long array into apply() blows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ text --- */

/** POST /api/import/text — the paste-it-in escape hatch, and what reels fall back to. */
export async function importText(request, env) {
  const body = await readJson(request);
  const content = text(body.text, 60_000);
  if (!content) throw new HttpError(400, 'There was no text to read.');

  const parsed = await recipeFromText(env, {
    body: content,
    sourceLabel: str(body.sourceName, 120),
    hint: str(body.hint, 300),
  });

  return draft(parsed, {
    sourceType: 'manual',
    sourceName: str(body.sourceName, 120),
    warning: parsed.confident === false ? 'That text was missing some of the recipe.' : null,
  });
}

/* ------------------------------------------------------------------ link --- */

/**
 * POST /api/import/link — one box for every kind of link.
 *
 * A TikTok and a food blog are the same gesture to the person pasting, so they
 * get the same endpoint; the difference in how they're read is ours to worry
 * about, not theirs.
 */
export async function importLink(request, env, ctx) {
  const body = await readJson(request);
  const url = parseUrl(body.url);
  const hint = str(body.hint, 300);

  if (socialPlatform(url)) return importSocial(env, url, hint);

  const { html, finalUrl } = await fetchPage(url);

  // 1. The site published structured data: take it, and don't call the model.
  const structured = recipeFromJsonLd(html);
  if (structured) {
    const imageKey = structured.imageUrl ? await storeRemoteImage(env, structured.imageUrl) : null;
    return draft(structured.recipe, {
      sourceType: 'link',
      sourceUrl: finalUrl,
      sourceName: structured.sourceName || siteName(html, url),
      imageKey,
      warning: structured.recipe.confident ? null : 'The site published ingredients but no steps.',
    });
  }

  // 2. It didn't. Read the page the way a person would.
  const readable = readableText(html);
  if (readable.length < 200) {
    throw new HttpError(422, "That page came back essentially empty — it probably builds itself with JavaScript. A screenshot of the recipe will work.");
  }

  const parsed = await recipeFromText(env, {
    body: readable,
    sourceLabel: siteName(html, url),
    url: finalUrl,
    hint,
  });

  const ogImage = meta(html, 'og:image');
  const imageKey = ogImage ? await storeRemoteImage(env, ogImage) : null;

  return draft(parsed, {
    sourceType: 'link',
    sourceUrl: finalUrl,
    sourceName: pageTitle(html) ? siteName(html, url) : url.hostname,
    imageKey,
    warning: parsed.confident === false
      ? "That page didn't have a full recipe on it — check what came through."
      : null,
  });
}

/* ---------------------------------------------------------------- social --- */

async function importSocial(env, url, hint) {
  const post = await fetchSocialPost(url);
  const thin = captionLooksThin(post.caption);

  const parsed = await recipeFromText(env, {
    body: post.caption,
    sourceLabel: `${post.platform} post by ${post.author}`,
    url: post.url,
    hint: [
      hint,
      'This is a social video caption. The video itself was not watched — only this text is available.',
    ].filter(Boolean).join(' '),
  });

  const imageKey = post.thumbnail ? await storeRemoteImage(env, post.thumbnail) : null;

  let warning = null;
  if (thin || parsed.confident === false) {
    warning = `${post.platform} only gives us the caption, and this one doesn't have the whole method in it. `
      + 'Screenshot the on-screen steps and import those to fill in the rest.';
  }

  return draft(parsed, {
    sourceType: 'social',
    sourceUrl: post.url,
    sourceName: `${post.author} on ${post.platform}`,
    imageKey,
    warning,
  });
}
