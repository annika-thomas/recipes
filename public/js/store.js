/**
 * Everything the app knows, and the only place that touches storage.
 *
 * There are two places a recipe box can live, and the screens don't know or
 * care which is in use: a server both phones talk to, or this device on its
 * own. The backend is picked once at boot by asking whether there's an API
 * behind this page, and every screen calls the same functions either way.
 *
 * With a server, the store deliberately refuses to get clever about caching:
 * any write refetches, and so does returning to the app. The cost is a round
 * trip; the benefit is that you never add a recipe your partner can't see.
 */

import { backend as serverBackend, ApiError } from './backends/server.js';
import { backend as localBackend } from './backends/local.js';

export { ApiError };

const listeners = new Set();

export const state = {
  ready: false,
  mode: 'server',      // 'server' | 'local'
  person: null,
  configured: true,
  canShare: true,      // false when the box only exists on this device
  categories: [],
  locations: [],
  recipes: [],
  cooks: [],
  pantry: [],
  loading: false,
  error: null,
};

let backend = serverBackend;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

/* --------------------------------------------------------- which backend --- */

/**
 * Is there a server behind this page?
 *
 * Asking is more reliable than guessing from the hostname: the same files are
 * served by the Worker, by GitHub Pages, and by `npm run dev`. A 404 (Pages
 * has no /api), HTML instead of JSON, or no response at all all mean the same
 * thing — we're on our own, so use the device.
 */
async function pickBackend() {
  // config.js can settle it without a request. On GitHub Pages that matters:
  // probing there is a guaranteed failure, and on a slow phone connection the
  // app would sit blank waiting for it.
  if (window.KITCHEN_MODE === 'local') return localBackend;

  try {
    const response = await fetch(new URL('api/session', document.baseURI), {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      // Never let the question of which backend to use hold up the app.
      signal: AbortSignal.timeout?.(3000),
    });
    if (!response.ok) return localBackend;
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) return localBackend;

    // Parse it here so the session request isn't made twice.
    const data = await response.json();
    serverBackend.primedSession = data;
    return serverBackend;
  } catch {
    return localBackend;
  }
}

/* -------------------------------------------------------------- session --- */

export async function loadSession() {
  backend = await pickBackend();

  const data = backend.primedSession || await backend.session();
  delete backend.primedSession;

  state.mode = backend.mode;
  state.person = data.person;
  state.configured = data.configured !== false;
  state.canShare = backend.mode === 'server';
  state.local = Boolean(data.local);
  state.categories = data.categories || [];
  state.locations = data.locations || [];
  emit();
  return data;
}

export async function signIn(passcode, person) {
  const data = await backend.signIn(passcode, person);
  state.person = data.person;
  emit();
  await refresh();
  return data;
}

export async function signOut() {
  await backend.signOut();
  state.person = null;
  state.recipes = [];
  state.cooks = [];
  state.pantry = [];
  emit();
}

/* ------------------------------------------------------------------ data --- */

export async function refresh() {
  if (!state.person) return;
  state.loading = true;
  state.error = null;
  emit();

  try {
    const { recipes, cooks, pantry } = await backend.loadAll();
    state.recipes = recipes;
    state.cooks = cooks;
    state.pantry = pantry;
    state.ready = true;
  } catch (err) {
    state.error = err.message;
    if (err.status !== 401) throw err;
  } finally {
    state.loading = false;
    emit();
  }
}

export function recipeById(id) {
  return state.recipes.find((r) => r.id === id) || null;
}

/** Fold a freshly-returned recipe back into the list without a full refetch. */
function mergeRecipe(recipe) {
  if (!recipe) return recipe;
  const index = state.recipes.findIndex((r) => r.id === recipe.id);
  if (index === -1) state.recipes.unshift(recipe);
  else state.recipes[index] = { ...state.recipes[index], ...recipe };
  emit();
  return recipe;
}

async function reloadCooks() {
  const { cooks } = await backend.loadAll();
  state.cooks = cooks;
  emit();
}

export async function fetchRecipe(id) {
  return mergeRecipe(await backend.getRecipe(id));
}

export async function saveRecipe(recipe) {
  return mergeRecipe(await backend.saveRecipe(recipe, state.person));
}

export async function removeRecipe(id) {
  await backend.deleteRecipe(id);
  state.recipes = state.recipes.filter((r) => r.id !== id);
  emit();
  await reloadCooks();
}

export async function rate(id, stars) {
  return mergeRecipe(await backend.rate(id, stars, state.person));
}

export async function addNote(id, body) {
  return mergeRecipe(await backend.addNote(id, body, state.person));
}

export async function removeNote(noteId) {
  await backend.deleteNote(noteId);
}

export async function logCook(id, { date, note, photoId }) {
  const recipe = await backend.logCook(id, { date, note, photoId }, state.person);
  mergeRecipe(recipe);
  await reloadCooks();
  return recipe;
}

export async function removeCook(cookId) {
  await backend.deleteCook(cookId);
  await reloadCooks();
}

/* --------------------------------------------------------------- pantry --- */

export async function addPantry(item) {
  state.pantry = await backend.addPantry(item, state.person);
  emit();
}

export async function removePantry(id) {
  state.pantry = await backend.deletePantry(id);
  emit();
}

export async function clearPantry() {
  state.pantry = await backend.clearPantry();
  emit();
}

export async function seedStaples() {
  state.pantry = await backend.seedStaples(state.person);
  emit();
}

export function suggestions(category) {
  return backend.suggest(category);
}

/* ---------------------------------------------------------- portability --- */

/**
 * A backup is the same JSON in both modes, which is what makes moving from a
 * device-only box to a shared one a file rather than a rewrite.
 */
export function exportData() {
  if (backend.exportAll) return backend.exportAll();
  return {
    exportedAt: new Date().toISOString(),
    recipes: state.recipes,
    cooks: state.cooks,
    pantry: state.pantry,
  };
}

export async function importData(parsed) {
  if (!backend.importAll) {
    throw new Error('Restoring into a shared kitchen isn’t supported yet — add the recipes by hand.');
  }
  const result = backend.importAll(parsed);
  await refresh();
  return result;
}

/* -------------------------------------------------------------- derived --- */

/** Cooks keyed by YYYY-MM-DD, for the calendar. */
export function cooksByDate() {
  const map = new Map();
  for (const cook of state.cooks) {
    if (!map.has(cook.date)) map.set(cook.date, []);
    map.get(cook.date).push(cook);
  }
  return map;
}

/** How many recipes sit in each category, for the filter chips. */
export function categoryCounts() {
  const counts = new Map();
  for (const recipe of state.recipes) {
    counts.set(recipe.category, (counts.get(recipe.category) || 0) + 1);
  }
  return counts;
}

/** The average of both people's stars, or null if nobody has rated it. */
export function averageStars(recipe) {
  const values = Object.values(recipe.ratings || {});
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
