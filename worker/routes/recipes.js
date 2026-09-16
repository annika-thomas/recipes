/** Recipes, plus the things that hang off them: cooks, ratings, notes. */

import { json, readJson, newId, nowIso, str, text, HttpError } from '../lib/http.js';
import { normaliseRecipe, rowToRecipe, SOURCE_TYPES } from '../lib/recipeSchema.js';

const LIVE = 'deleted_at IS NULL';

/**
 * The whole library in one request.
 *
 * Two people and a few hundred recipes is small enough that paginating would
 * cost more in complexity than it saves in bytes — and having everything
 * client-side is what makes search and the pantry matcher feel instant.
 */
export async function listRecipes(env) {
  const [recipes, ratings, cooks] = await Promise.all([
    env.DB.prepare(`SELECT * FROM recipes WHERE ${LIVE} ORDER BY updated_at DESC`).all(),
    env.DB.prepare('SELECT recipe_id, person, stars FROM ratings').all(),
    env.DB.prepare(`
      SELECT recipe_id, COUNT(*) AS times, MAX(cooked_on) AS last_cooked
      FROM cooks GROUP BY recipe_id
    `).all(),
  ]);

  const byId = new Map();
  for (const row of recipes.results) {
    byId.set(row.id, { ...rowToRecipe(row), ratings: {}, timesCooked: 0, lastCooked: null });
  }
  for (const r of ratings.results) {
    const recipe = byId.get(r.recipe_id);
    if (recipe) recipe.ratings[r.person] = r.stars;
  }
  for (const c of cooks.results) {
    const recipe = byId.get(c.recipe_id);
    if (recipe) { recipe.timesCooked = c.times; recipe.lastCooked = c.last_cooked; }
  }

  return json({ recipes: [...byId.values()] });
}

export async function getRecipe(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM recipes WHERE id = ? AND ${LIVE}`).bind(id).first();
  if (!row) throw new HttpError(404, "That recipe isn't here any more.");

  const [ratings, notes, cooks] = await Promise.all([
    env.DB.prepare('SELECT person, stars FROM ratings WHERE recipe_id = ?').bind(id).all(),
    env.DB.prepare('SELECT * FROM notes WHERE recipe_id = ? ORDER BY created_at DESC').bind(id).all(),
    env.DB.prepare('SELECT * FROM cooks WHERE recipe_id = ? ORDER BY cooked_on DESC').bind(id).all(),
  ]);

  const recipe = rowToRecipe(row);
  recipe.ratings = Object.fromEntries(ratings.results.map((r) => [r.person, r.stars]));
  recipe.notes = notes.results.map((n) => ({
    id: n.id, person: n.person, body: n.body, createdAt: n.created_at,
  }));
  recipe.cooks = cooks.results.map((c) => ({
    id: c.id, date: c.cooked_on, by: c.cooked_by, note: c.note,
  }));
  recipe.timesCooked = recipe.cooks.length;
  recipe.lastCooked = recipe.cooks[0]?.date || null;

  return json({ recipe });
}

function sourceFields(body) {
  const type = SOURCE_TYPES.includes(body.sourceType) ? body.sourceType : 'manual';
  return {
    source_type: type,
    source_url: str(body.sourceUrl, 1000),
    source_name: str(body.sourceName, 120),
    image_key: str(body.imageKey, 200),
  };
}

export async function createRecipe(request, env, person) {
  const body = await readJson(request);
  const recipe = normaliseRecipe(body);
  const source = sourceFields(body);
  const id = newId('r');
  const ts = nowIso();

  await env.DB.prepare(`
    INSERT INTO recipes (
      id, title, description, category, cuisine, servings, servings_unit,
      prep_min, cook_min, ingredients, steps, tags,
      source_type, source_url, source_name, source_note, image_key,
      added_by, created_at, updated_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
  `).bind(
    id, recipe.title, recipe.description, recipe.category, recipe.cuisine,
    recipe.servings, recipe.servings_unit, recipe.prep_min, recipe.cook_min,
    JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps), JSON.stringify(recipe.tags),
    source.source_type, source.source_url, source.source_name, recipe.source_note, source.image_key,
    person, ts, ts,
  ).run();

  return getRecipe(env, id);
}

export async function updateRecipe(request, env, id) {
  const existing = await env.DB.prepare(`SELECT id FROM recipes WHERE id = ? AND ${LIVE}`).bind(id).first();
  if (!existing) throw new HttpError(404, "That recipe isn't here any more.");

  const body = await readJson(request);
  const recipe = normaliseRecipe(body);
  const source = sourceFields(body);

  await env.DB.prepare(`
    UPDATE recipes SET
      title = ?2, description = ?3, category = ?4, cuisine = ?5,
      servings = ?6, servings_unit = ?7, prep_min = ?8, cook_min = ?9,
      ingredients = ?10, steps = ?11, tags = ?12,
      source_url = ?13, source_name = ?14, source_note = ?15,
      image_key = COALESCE(?16, image_key),
      updated_at = ?17
    WHERE id = ?1
  `).bind(
    id, recipe.title, recipe.description, recipe.category, recipe.cuisine,
    recipe.servings, recipe.servings_unit, recipe.prep_min, recipe.cook_min,
    JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps), JSON.stringify(recipe.tags),
    source.source_url, source.source_name, recipe.source_note, source.image_key,
    nowIso(),
  ).run();

  return getRecipe(env, id);
}

/**
 * Tombstone rather than delete: the calendar still has to be able to say what
 * you cooked in March, even if the recipe is long gone from the library.
 */
export async function deleteRecipe(env, id) {
  await env.DB.prepare('UPDATE recipes SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1')
    .bind(id, nowIso()).run();
  return json({ ok: true });
}

/* ---------------------------------------------------------------- cooks --- */

/** "We made this." Dates are the local YYYY-MM-DD the phone sends, never UTC. */
export async function logCook(request, env, id, person) {
  const body = await readJson(request);
  const date = str(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new HttpError(400, 'A cook needs a date like 2026-09-16.');
  }
  const recipe = await env.DB.prepare(`SELECT id FROM recipes WHERE id = ? AND ${LIVE}`).bind(id).first();
  if (!recipe) throw new HttpError(404, "That recipe isn't here any more.");

  await env.DB.prepare(`
    INSERT INTO cooks (id, recipe_id, cooked_on, cooked_by, note, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(newId('c'), id, date, str(body.by, 40) || person, text(body.note, 500), nowIso()).run();

  return getRecipe(env, id);
}

export async function deleteCook(env, cookId) {
  await env.DB.prepare('DELETE FROM cooks WHERE id = ?').bind(cookId).run();
  return json({ ok: true });
}

/** Every cook, for the calendar — joined to titles so it renders in one pass. */
export async function listCooks(env) {
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.recipe_id, c.cooked_on, c.cooked_by, c.note,
           r.title, r.category, r.image_key, r.deleted_at
    FROM cooks c JOIN recipes r ON r.id = c.recipe_id
    ORDER BY c.cooked_on DESC
  `).all();

  return json({
    cooks: results.map((c) => ({
      id: c.id,
      recipeId: c.recipe_id,
      date: c.cooked_on,
      by: c.cooked_by,
      note: c.note,
      title: c.title,
      category: c.category,
      image: c.image_key ? `/img/${c.image_key}` : null,
      recipeGone: Boolean(c.deleted_at),
    })),
  });
}

/* -------------------------------------------------------- ratings/notes --- */

export async function rateRecipe(request, env, id, person) {
  const body = await readJson(request);
  const stars = Math.round(Number(body.stars));

  if (stars === 0) {
    await env.DB.prepare('DELETE FROM ratings WHERE recipe_id = ? AND person = ?').bind(id, person).run();
    return getRecipe(env, id);
  }
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    throw new HttpError(400, 'A rating is 1 to 5 stars (or 0 to clear it).');
  }

  await env.DB.prepare(`
    INSERT INTO ratings (recipe_id, person, stars, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (recipe_id, person) DO UPDATE SET stars = ?3, updated_at = ?4
  `).bind(id, person, stars, nowIso()).run();

  return getRecipe(env, id);
}

export async function addNote(request, env, id, person) {
  const body = await readJson(request);
  const note = text(body.body, 2000);
  if (!note) throw new HttpError(400, 'An empty note has nothing to say.');

  await env.DB.prepare(`
    INSERT INTO notes (id, recipe_id, person, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(newId('n'), id, person, note, nowIso()).run();

  return getRecipe(env, id);
}

export async function deleteNote(env, noteId) {
  await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(noteId).run();
  return json({ ok: true });
}
