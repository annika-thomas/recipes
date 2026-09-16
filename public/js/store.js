/**
 * Everything the app knows, and the only place that talks to the server.
 *
 * Because two phones share one database, the store refuses to get clever about
 * caching: any write refetches, and opening the app or bringing it back to the
 * foreground refetches too. The cost is a round trip; the benefit is that you
 * never add a recipe your partner can't see, or rate one they just deleted.
 */

const listeners = new Set();

export const state = {
  ready: false,
  person: null,
  configured: true,
  local: false,
  canImport: true,
  categories: [],
  locations: [],
  recipes: [],
  cooks: [],
  pantry: [],
  loading: false,
  error: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

/* ------------------------------------------------------------- transport --- */

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}
export { ApiError };

async function call(path, { method = 'GET', body, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };

  if (form) {
    init.body = form; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError("Can't reach the kitchen — check your signal.", 0);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      state.person = null;
      emit();
    }
    throw new ApiError(payload.error || `Something went wrong (${response.status}).`, response.status, payload);
  }
  return payload;
}

/* -------------------------------------------------------------- session --- */

export async function loadSession() {
  const data = await call('/session');
  state.person = data.person;
  state.configured = data.configured;
  state.local = Boolean(data.local);
  state.canImport = data.canImport;
  state.categories = data.categories || [];
  state.locations = data.locations || [];
  emit();
  return data;
}

export async function signIn(passcode, person) {
  const data = await call('/session', { method: 'POST', body: { passcode, person } });
  state.person = data.person;
  emit();
  await refresh();
  return data;
}

export async function signOut() {
  await call('/session', { method: 'DELETE' });
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
    const [recipes, cooks, pantry] = await Promise.all([
      call('/recipes'), call('/cooks'), call('/pantry'),
    ]);
    state.recipes = recipes.recipes || [];
    state.cooks = cooks.cooks || [];
    state.pantry = pantry.pantry || [];
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

export async function fetchRecipe(id) {
  const { recipe } = await call(`/recipes/${id}`);
  return mergeRecipe(recipe);
}

export async function saveRecipe(recipe) {
  const { recipe: saved } = recipe.id
    ? await call(`/recipes/${recipe.id}`, { method: 'PUT', body: recipe })
    : await call('/recipes', { method: 'POST', body: recipe });
  mergeRecipe(saved);
  return saved;
}

export async function removeRecipe(id) {
  await call(`/recipes/${id}`, { method: 'DELETE' });
  state.recipes = state.recipes.filter((r) => r.id !== id);
  emit();
  await reloadCooks();
}

export async function rate(id, stars) {
  const { recipe } = await call(`/recipes/${id}/rating`, { method: 'PUT', body: { stars } });
  return mergeRecipe(recipe);
}

export async function addNote(id, body) {
  const { recipe } = await call(`/recipes/${id}/notes`, { method: 'POST', body: { body } });
  return mergeRecipe(recipe);
}

export async function removeNote(noteId) {
  await call(`/notes/${noteId}`, { method: 'DELETE' });
}

export async function logCook(id, { date, note }) {
  const { recipe } = await call(`/recipes/${id}/cooks`, { method: 'POST', body: { date, note } });
  mergeRecipe(recipe);
  await reloadCooks();
  return recipe;
}

export async function removeCook(cookId) {
  await call(`/cooks/${cookId}`, { method: 'DELETE' });
  await reloadCooks();
}

async function reloadCooks() {
  const { cooks } = await call('/cooks');
  state.cooks = cooks || [];
  emit();
}

/* ------------------------------------------------------------- pantry --- */

export async function addPantry(item) {
  const { pantry } = await call('/pantry', { method: 'POST', body: item });
  state.pantry = pantry || [];
  emit();
}

export async function removePantry(id) {
  const { pantry } = await call(`/pantry/${id}`, { method: 'DELETE' });
  state.pantry = pantry || [];
  emit();
}

export async function clearPantry() {
  const { pantry } = await call('/pantry', { method: 'DELETE' });
  state.pantry = pantry || [];
  emit();
}

export async function seedStaples() {
  const { pantry } = await call('/pantry/staples', { method: 'POST' });
  state.pantry = pantry || [];
  emit();
}

export async function suggestions(category) {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return call(`/suggest${query}`);
}

/* ------------------------------------------------------------- imports --- */

export async function importPhotos(files, hint) {
  const form = new FormData();
  for (const file of files) form.append('image', file, file.name || 'photo.jpg');
  if (hint) form.append('hint', hint);
  return call('/import/photo', { method: 'POST', form });
}

export async function importLink(url, hint) {
  return call('/import/link', { method: 'POST', body: { url, hint } });
}

export async function importText(text, sourceName) {
  return call('/import/text', { method: 'POST', body: { text, sourceName } });
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
