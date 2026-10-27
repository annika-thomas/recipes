/**
 * Reading a recipe with Claude, for the things the parser can't: a screenshot,
 * a photo of a cookbook page, a paragraph of prose with the amounts buried in
 * it.
 *
 * Straight from the browser to Anthropic's API with your own key. There's no
 * server in the GitHub Pages copy to hide a key behind, so the key lives where
 * the recipes do — in this browser's storage, on this device — and is sent to
 * api.anthropic.com and nowhere else.
 *
 * The SDK is loaded from a CDN the first time it's needed rather than shipped
 * with the app, because the app has no build step and most visits never read a
 * recipe. It's pinned to an exact version so what runs is what was tested.
 *
 * What comes back has the same shape as parseRecipeText's output, so the
 * editor can't tell which one read the recipe — and, like the parser, it opens
 * as a form to check rather than saving itself.
 */

import { CATEGORY_IDS } from '../util/recipe.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'kitchen.anthropicKey';

/** Claude reads images up to about this size on the long edge; bigger is wasted upload. */
const MAX_EDGE = 1568;
export const MAX_IMAGES = 6;

/* ------------------------------------------------------------------ key --- */

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

/* --------------------------------------------------------------- schema --- */

const nullable = (type) => ({ type: [type, 'null'] });

/**
 * What Claude is asked to return. Field names match parseRecipeText so the
 * result drops straight into the editor. `doubts` is the one addition: what it
 * wasn't sure of, shown at the top of the form.
 */
export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'found', 'title', 'description', 'category', 'cuisine', 'servings', 'servingsUnit',
    'prepMin', 'cookMin', 'ingredients', 'steps', 'tags', 'sourceNote', 'sourceUrl', 'doubts',
  ],
  properties: {
    found: { type: 'boolean' },
    title: nullable('string'),
    description: nullable('string'),
    category: { type: 'string', enum: CATEGORY_IDS },
    cuisine: nullable('string'),
    servings: nullable('number'),
    servingsUnit: nullable('string'),
    prepMin: nullable('integer'),
    cookMin: nullable('integer'),
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['qty', 'unit', 'item', 'note', 'group'],
        properties: {
          qty: nullable('number'),
          unit: nullable('string'),
          item: { type: 'string' },
          note: nullable('string'),
          group: nullable('string'),
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'group'],
        properties: {
          text: { type: 'string' },
          group: nullable('string'),
        },
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
    sourceNote: nullable('string'),
    sourceUrl: nullable('string'),
    doubts: nullable('string'),
  },
};

const SYSTEM = `You turn recipes into structured data for a personal recipe journal.

The input is whatever someone pasted: text copied from a website or a message, screenshots, photos of a cookbook page or a handwritten card, or a link to a recipe page. Several images may be pages of the same recipe. Read all of it and return one recipe.

If there is a link, fetch it with web_fetch and read the recipe from the page. Fetch only links the person gave you, and only the one the recipe is on. If the page can't be fetched or has no recipe on it (a login wall, a paywall, a video with no written recipe), say so in doubts and use whatever else was pasted.

Transcribe; never invent. If a quantity, time or serving count isn't in the source, return null for it rather than a typical value. Keep the author's wording for steps, but drop step numbers, ads, life stories, nutrition panels and comments.

Ingredients, one per line in the source:
- qty is a plain number: "1 1/2" is 1.5, "½" is 0.5, "a pinch" is 1 with unit "pinch". For a range like "2-3 cloves" use the lower number and put "2-3" in the note.
- unit is a short lowercase unit: g, kg, mg, oz, lb, ml, l, tsp, tbsp, cup, pint, quart, clove, can, tin, jar, packet, bunch, sprig, stalk, stick, head, slice, piece, pinch, dash, handful, fillet, sheet. Null for countable things ("2 onions").
- item is the ingredient alone ("garlic", "unsalted butter"); prep and asides go in note ("finely minced", "at room temperature", "plus extra to serve").
- group is the sub-heading it sits under ("For the sauce"), or null.

Steps: one entry per step, with group set to the sub-heading it sits under, or null.

servingsUnit is "servings" unless the recipe counts something else ("cookies", "loaves"). prepMin and cookMin are whole minutes. category is your best fit from the allowed list. tags are a few lowercase words that would help find it again ("vegetarian", "one-pot", "quick").

sourceUrl is the address of the page the recipe came from, if there was a link, else null.

sourceNote is for tips, storage or make-ahead notes worth keeping from the source, or null. doubts is a short plain sentence on anything you couldn't read or had to guess at — a cut-off photo, an illegible amount, a step that seemed to be missing — or null if it was all clear.

If there is no recipe in the input at all, set found to false and leave everything else empty or null.`;

/* --------------------------------------------------------------- images --- */

/**
 * Shrink an image to what the model actually looks at and hand back base64
 * JPEG. Going through a canvas also turns HEIC from an iPhone into something
 * the API accepts.
 */
export async function imageForClaude(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error("Couldn't read that image.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { media_type: 'image/jpeg', data: btoa(binary) };
}

/* ----------------------------------------------------------------- links --- */

/** Web addresses in pasted text, so a bare link can be read as a recipe. */
export function findLinks(text = '') {
  const found = String(text).match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(found.map((url) => url.replace(/[.,;:!?]+$/, '')))];
}

/**
 * Lets Claude load a page someone gave it. Only links in the message can be
 * fetched — the API enforces that — and a page's worth of text is capped so
 * one bloated blog post can't run up the bill.
 */
const WEB_FETCH = {
  type: 'web_fetch_20260318',
  name: 'web_fetch',
  max_uses: 3,
  max_content_tokens: 40000,
  // Claude reads the page; the browser doesn't need it echoed back.
  response_inclusion: 'excluded',
};

/** A server tool pausing mid-turn resumes this many times before giving up. */
const MAX_RESUMES = 3;

/* ----------------------------------------------------------------- read --- */

let sdkPromise = null;

function loadSdk() {
  sdkPromise ||= import(SDK_URL).then((mod) => mod.default).catch((err) => {
    sdkPromise = null;
    throw err;
  });
  return sdkPromise;
}

/** The message content for one request: images first, then the text. */
export function buildContent({ text = '', images = [] }) {
  const content = images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.media_type, data: image.data },
  }));
  const trimmed = text.trim();
  const links = findLinks(trimmed);
  let ask;
  if (!trimmed) ask = 'Read the recipe in these images.';
  else if (links.length && trimmed === links[0]) ask = `Read the recipe at this link:\n\n${links[0]}`;
  else {
    ask = `${images.length ? 'Along with the images above, here is' : 'Here is'} the pasted text:\n\n<pasted>\n${trimmed}\n</pasted>`;
  }
  content.push({ type: 'text', text: ask });
  return content;
}

/**
 * Turn Claude's JSON into the draft the editor takes — the same fields
 * parseRecipeText produces, with blanks rather than empty strings.
 */
export function toDraft(result) {
  const blank = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const number = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

  const ingredients = (Array.isArray(result?.ingredients) ? result.ingredients : [])
    .map((i) => ({
      qty: number(i?.qty),
      unit: blank(i?.unit),
      item: blank(i?.item),
      note: blank(i?.note),
      group: blank(i?.group),
    }))
    .filter((i) => i.item);

  const steps = (Array.isArray(result?.steps) ? result.steps : [])
    .map((s) => ({ text: blank(s?.text), group: blank(s?.group) }))
    .filter((s) => s.text);

  return {
    title: blank(result?.title),
    description: blank(result?.description),
    category: CATEGORY_IDS.includes(result?.category) ? result.category : 'mains',
    cuisine: blank(result?.cuisine),
    servings: number(result?.servings),
    servingsUnit: blank(result?.servingsUnit),
    prepMin: number(result?.prepMin),
    cookMin: number(result?.cookMin),
    ingredients,
    steps,
    tags: (Array.isArray(result?.tags) ? result.tags : []).map(blank).filter(Boolean),
    sourceNote: blank(result?.sourceNote),
    sourceUrl: /^https?:\/\//i.test(blank(result?.sourceUrl) || '') ? blank(result.sourceUrl) : null,
    doubts: blank(result?.doubts),
    found: result?.found !== false && (ingredients.length > 0 || steps.length > 0),
  };
}

/**
 * Read a recipe from pasted text and/or images.
 * `images` are { media_type, data } from imageForClaude.
 * Throws an Error with a message fit to show as-is.
 */
export async function readRecipe({ text = '', images = [], apiKey = getApiKey() } = {}) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings first.');

  let Anthropic;
  try {
    Anthropic = await loadSdk();
  } catch {
    throw new Error("Couldn't reach Claude — check you're online and try again.");
  }

  const client = new Anthropic({
    apiKey,
    // The key is the user's own and stays on their device; there is no
    // server in this copy of the app to proxy through.
    dangerouslyAllowBrowser: true,
  });

  const messages = [{ role: 'user', content: buildContent({ text, images }) }];
  const withLink = findLinks(text).length > 0;

  let response;
  try {
    for (let resumes = 0; ; resumes += 1) {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages,
        // Only offered when there's a link, so a plain paste can't wander off
        // to the web.
        ...(withLink ? { tools: [WEB_FETCH] } : {}),
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: RECIPE_SCHEMA },
        },
        // If a safety classifier declines, let the API retry on its
        // recommended fallback model instead of failing the paste.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      // A long fetch can pause the turn; sending it back resumes it.
      if (response.stop_reason !== 'pause_turn' || resumes >= MAX_RESUMES) break;
      messages.push({ role: 'assistant', content: response.content });
    }
  } catch (err) {
    throw new Error(describeError(Anthropic, err, { withLink }));
  }

  if (response.stop_reason === 'pause_turn') {
    throw new Error("Reading that page took too long. Try again, or paste a screenshot instead.");
  }

  if (response.stop_reason === 'refusal') {
    throw new Error("Claude wouldn't read that one. The original is still in the box if you want to try the plain reader.");
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('That recipe was too long to read in one go. Try pasting it in two halves.');
  }

  // With a fetch there can be blocks before the answer; the answer is last.
  const block = response.content.findLast((b) => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(block?.text ?? '');
  } catch {
    throw new Error("Claude's answer came back garbled. Try again.");
  }
  return toDraft(parsed);
}

/**
 * Check a key works before it's saved, so a typo turns up on the settings
 * screen rather than halfway through adding a recipe. Looking up the model is
 * free and proves both that the key is real and that it can use the model.
 * It can't tell whether the account has credit — only a real read can.
 */
export async function checkApiKey(apiKey) {
  let Anthropic;
  try {
    Anthropic = await loadSdk();
  } catch {
    throw new Error("Couldn't reach Anthropic to check the key — are you online?");
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try {
    await client.models.retrieve(MODEL);
  } catch (err) {
    if (err instanceof Anthropic.NotFoundError) {
      throw new Error("That key works, but it can't use Claude Opus 5.5. Check your Anthropic account.");
    }
    throw new Error(describeError(Anthropic, err));
  }
}

function describeError(Anthropic, err, { withLink = false } = {}) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'That API key was turned down. Check it in Settings.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "That API key isn't allowed to use this model. Check your Anthropic account.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Too many requests just now — wait a moment and try again.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    // An organisation admin can switch web fetch off in the Claude Console.
    if (withLink && err.error?.error?.type === 'invalid_request_error' && /web.?fetch/i.test(err.message)) {
      return 'Your Anthropic account has web fetch turned off, so it can\'t read links. '
        + 'Turn it on under Capabilities in the Claude Console, or paste a screenshot instead.';
    }
    // Also what an account with no credit gets back.
    return "Claude couldn't take that request. Check your Anthropic account has credit, "
      + 'or try fewer or smaller images.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Claude — check you're online and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude had a problem (${err.status ?? 'unknown'}). Try again in a minute.`;
  }
  return "Something went wrong reading that. Try again.";
}
