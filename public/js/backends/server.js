/**
 * The recipe box on a server, shared between two phones.
 *
 * Every call is a request to the Worker on the same origin. This is the
 * backend that can do the things the device-only one can't: both of you see
 * the same recipes, screenshots get read, links get fetched.
 */

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

/** Resolved against the page, so this works at a domain root or under a path. */
function apiUrl(path) {
  return new URL(`api${path}`, document.baseURI).toString();
}

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
    response = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError("Can't reach the kitchen — check your signal.", 0);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      payload.error || `Something went wrong (${response.status}).`,
      response.status,
      payload,
    );
  }
  return payload;
}

export const backend = {
  mode: 'server',

  session: () => call('/session'),

  signIn: (passcode, person) => call('/session', { method: 'POST', body: { passcode, person } }),
  signOut: () => call('/session', { method: 'DELETE' }),

  async loadAll() {
    const [recipes, cooks, pantry] = await Promise.all([
      call('/recipes'), call('/cooks'), call('/pantry'),
    ]);
    return {
      recipes: recipes.recipes || [],
      cooks: cooks.cooks || [],
      pantry: pantry.pantry || [],
    };
  },

  getRecipe: (id) => call(`/recipes/${id}`).then((r) => r.recipe),

  saveRecipe: (recipe) => (recipe.id
    ? call(`/recipes/${recipe.id}`, { method: 'PUT', body: recipe })
    : call('/recipes', { method: 'POST', body: recipe })).then((r) => r.recipe),

  deleteRecipe: (id) => call(`/recipes/${id}`, { method: 'DELETE' }),

  rate: (id, stars) => call(`/recipes/${id}/rating`, { method: 'PUT', body: { stars } })
    .then((r) => r.recipe),

  addNote: (id, body) => call(`/recipes/${id}/notes`, { method: 'POST', body: { body } })
    .then((r) => r.recipe),

  deleteNote: (noteId) => call(`/notes/${noteId}`, { method: 'DELETE' }),

  logCook: (id, { date, note }) => call(`/recipes/${id}/cooks`, { method: 'POST', body: { date, note } })
    .then((r) => r.recipe),

  deleteCook: (cookId) => call(`/cooks/${cookId}`, { method: 'DELETE' }),

  addPantry: (item) => call('/pantry', { method: 'POST', body: item }).then((r) => r.pantry),
  deletePantry: (id) => call(`/pantry/${id}`, { method: 'DELETE' }).then((r) => r.pantry),
  clearPantry: () => call('/pantry', { method: 'DELETE' }).then((r) => r.pantry),
  seedStaples: () => call('/pantry/staples', { method: 'POST' }).then((r) => r.pantry),

  suggest: (category) => call(`/suggest${category ? `?category=${encodeURIComponent(category)}` : ''}`),
};
