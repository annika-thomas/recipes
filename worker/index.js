/**
 * Kitchen — the server half.
 *
 * Everything lives on one origin: the Worker answers /api/* and /img/*, and
 * Cloudflare serves the app itself out of public/ for everything else. One
 * origin means no CORS, no preflights, and one URL to put on a home screen.
 */

import { json, error, HttpError } from './lib/http.js';
import { signIn, signOutCookie, currentPerson, requirePerson, isLocal } from './lib/auth.js';
import { CATEGORIES } from './lib/recipeSchema.js';
import {
  listRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe,
  logCook, deleteCook, listCooks, rateRecipe, addNote, deleteNote,
} from './routes/recipes.js';
import {
  listPantry, addPantryItem, deletePantryItem, clearPantry, seedStaples, suggest, LOCATIONS,
} from './routes/pantry.js';
import { importPhoto, importLink, importText } from './routes/import.js';
import { uploadImage, serveImage } from './routes/images.js';

/** Routes that work signed out: the login itself, and asking who you are. */
const PUBLIC = new Set(['POST /api/session', 'GET /api/session', 'DELETE /api/session']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/img/')) {
        // Photos are unguessable keys, and <img> tags can't send credentials
        // on every platform — so these are served without the session check.
        return await serveImage(env, decodeURIComponent(url.pathname.slice(5)));
      }
      if (url.pathname.startsWith('/api/')) {
        return await api(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return error(err.message, err.status, err.extra);
      console.error('Unhandled error:', err?.stack || err);
      return error('Something broke on our side. Try that again.', 500);
    }
  },
};

async function api(request, env, ctx, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const route = `${method} ${path}`;

  if (!env.DB) {
    throw new HttpError(500, 'No database is bound. Check the d1_databases block in wrangler.toml.');
  }

  /* ------------------------------------------------------------ session --- */

  if (route === 'GET /api/session') {
    const person = await currentPerson(request, env);
    return json({
      person,
      configured: Boolean(env.HOUSEHOLD_PASSCODE && env.SESSION_SECRET),
      local: isLocal(request),
      canImport: Boolean(env.ANTHROPIC_API_KEY),
      categories: CATEGORIES,
      locations: LOCATIONS,
    });
  }

  if (route === 'POST /api/session') {
    const body = await request.json().catch(() => ({}));
    const { person, cookie } = await signIn(env, body.passcode, body.person, { local: isLocal(request) });
    return json({ person }, 200, { 'set-cookie': cookie });
  }

  if (route === 'DELETE /api/session') {
    return json({ ok: true }, 200, { 'set-cookie': signOutCookie(isLocal(request)) });
  }

  if (!PUBLIC.has(route)) await requirePerson(request, env);
  const person = await currentPerson(request, env);

  /* ------------------------------------------------------------ recipes --- */

  if (route === 'GET /api/recipes') return listRecipes(env);
  if (route === 'POST /api/recipes') return createRecipe(request, env, person);

  const recipeMatch = /^\/api\/recipes\/([\w-]+)$/.exec(path);
  if (recipeMatch) {
    const id = recipeMatch[1];
    if (method === 'GET') return getRecipe(env, id);
    if (method === 'PUT') return updateRecipe(request, env, id);
    if (method === 'DELETE') return deleteRecipe(env, id);
  }

  const subMatch = /^\/api\/recipes\/([\w-]+)\/(cooks|rating|notes)$/.exec(path);
  if (subMatch) {
    const [, id, kind] = subMatch;
    if (kind === 'cooks' && method === 'POST') return logCook(request, env, id, person);
    if (kind === 'rating' && method === 'PUT') return rateRecipe(request, env, id, person);
    if (kind === 'notes' && method === 'POST') return addNote(request, env, id, person);
  }

  /* -------------------------------------------------------------- cooks --- */

  if (route === 'GET /api/cooks') return listCooks(env);

  const cookMatch = /^\/api\/cooks\/([\w-]+)$/.exec(path);
  if (cookMatch && method === 'DELETE') return deleteCook(env, cookMatch[1]);

  const noteMatch = /^\/api\/notes\/([\w-]+)$/.exec(path);
  if (noteMatch && method === 'DELETE') return deleteNote(env, noteMatch[1]);

  /* ------------------------------------------------------------- pantry --- */

  if (route === 'GET /api/pantry') return listPantry(env);
  if (route === 'POST /api/pantry') return addPantryItem(request, env, person);
  if (route === 'DELETE /api/pantry') return clearPantry(env);
  if (route === 'POST /api/pantry/staples') return seedStaples(env, person);

  const pantryMatch = /^\/api\/pantry\/([\w-]+)$/.exec(path);
  if (pantryMatch && method === 'DELETE') return deletePantryItem(env, pantryMatch[1]);

  if (route === 'GET /api/suggest') return suggest(env, url);

  /* ------------------------------------------------------------ imports --- */

  if (route === 'POST /api/import/photo') return importPhoto(request, env);
  if (route === 'POST /api/import/link') return importLink(request, env, ctx);
  if (route === 'POST /api/import/text') return importText(request, env);
  if (route === 'POST /api/images') return uploadImage(request, env);

  return error(`No route for ${route}.`, 404);
}
