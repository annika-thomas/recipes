/**
 * What's in the house, and what that means you can cook.
 *
 * The ingredient matching itself lives in public/js/util/match.js, shared with
 * the browser so the app and the server always agree about what you have.
 */

import { json, readJson, newId, nowIso, str, HttpError } from '../lib/http.js';
import { normaliseIngredientName, covered, rowToRecipe } from '../lib/recipeSchema.js';

// Shared with the browser, which needs the same list when it runs serverless.
export { LOCATIONS } from '../../public/js/util/recipe.js';
import { DEFAULT_STAPLES } from '../../public/js/util/recipe.js';

export async function listPantry(env) {
  const { results } = await env.DB.prepare('SELECT * FROM pantry ORDER BY location, name').all();
  return json({
    pantry: results.map((p) => ({
      id: p.id, name: p.name, norm: p.norm, location: p.location,
      qty: p.qty, staple: Boolean(p.staple), addedBy: p.added_by, updatedAt: p.updated_at,
    })),
  });
}

export async function addPantryItem(request, env, person) {
  const body = await readJson(request);
  const name = str(body.name, 80);
  if (!name) throw new HttpError(400, 'That item needs a name.');

  const norm = normaliseIngredientName(name) || name.toLowerCase();
  const location = LOCATIONS.includes(body.location) ? body.location : 'pantry';

  // Adding something you already have updates it rather than duplicating it.
  await env.DB.prepare(`
    INSERT INTO pantry (id, name, norm, location, qty, staple, added_by, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT (norm) DO UPDATE SET
      name = ?2, location = ?4, qty = ?5, staple = ?6, updated_at = ?8
  `).bind(
    newId('p'), name, norm, location, str(body.qty, 40),
    body.staple ? 1 : 0, person, nowIso(),
  ).run();

  return listPantry(env);
}

export async function deletePantryItem(env, id) {
  await env.DB.prepare('DELETE FROM pantry WHERE id = ?').bind(id).run();
  return listPantry(env);
}

/** Wipe the non-staples — the "we just did a big shop" reset. */
export async function clearPantry(env) {
  await env.DB.prepare('DELETE FROM pantry WHERE staple = 0').run();
  return listPantry(env);
}

export async function seedStaples(env, person) {
  const ts = nowIso();
  const statements = DEFAULT_STAPLES.map((name) => env.DB.prepare(`
    INSERT INTO pantry (id, name, norm, location, qty, staple, added_by, updated_at)
    VALUES (?1, ?2, ?3, 'pantry', NULL, 1, ?4, ?5)
    ON CONFLICT (norm) DO UPDATE SET staple = 1, updated_at = ?5
  `).bind(newId('p'), name, normaliseIngredientName(name) || name, person, ts));

  await env.DB.batch(statements);
  return listPantry(env);
}

/**
 * Rank every recipe by how much of it you already have.
 *
 * Nothing is hidden — a recipe you're four things short of still appears, at
 * the bottom, with the shopping list attached. Ties break toward the thing you
 * haven't cooked in longest, so the same four dinners don't win every week.
 */
export async function suggest(env, url) {
  const category = str(url.searchParams.get('category'), 40);

  const [recipeRows, pantryRows, cookRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM recipes WHERE deleted_at IS NULL').all(),
    env.DB.prepare('SELECT norm FROM pantry').all(),
    env.DB.prepare('SELECT recipe_id, MAX(cooked_on) AS last_cooked, COUNT(*) AS times FROM cooks GROUP BY recipe_id').all(),
  ]);

  const pantryNorms = pantryRows.results.map((p) => p.norm).filter(Boolean);
  const cookStats = new Map(cookRows.results.map((c) => [c.recipe_id, c]));

  const scored = recipeRows.results
    .filter((row) => !category || row.category === category)
    .map((row) => {
      const recipe = rowToRecipe(row);
      const have = [];
      const missing = [];

      for (const ing of recipe.ingredients) {
        (covered(ing.item, pantryNorms) ? have : missing).push(ing.item);
      }

      const total = have.length + missing.length;
      const coverage = total ? have.length / total : 0;
      const stats = cookStats.get(recipe.id);

      return {
        recipe: { ...recipe, timesCooked: stats?.times || 0, lastCooked: stats?.last_cooked || null },
        coverage,
        have: have.length,
        missing,
        total,
      };
    })
    // Recipes with no ingredient list can't be matched — they'd always read 0%.
    .filter((s) => s.total > 0)
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      const aLast = a.recipe.lastCooked || '';
      const bLast = b.recipe.lastCooked || '';
      return aLast.localeCompare(bLast); // never-cooked (empty string) floats up
    })
    .slice(0, 40);

  return json({ suggestions: scored, pantrySize: pantryNorms.length });
}
