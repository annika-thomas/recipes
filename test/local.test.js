/**
 * The device-only backend — what runs on GitHub Pages, where there is no server
 * and no database to fall back on.
 *
 * These matter more than the server tests, because when this breaks there's no
 * log to look at: the recipes are on someone's phone and the failure is silent.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Enough of localStorage to run the backend under Node. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new MemoryStorage();

const { backend } = await import('../public/js/backends/local.js');

const TODAY = '2026-09-16';

async function addRecipe(overrides = {}) {
  return backend.saveRecipe({
    title: 'Weeknight dal',
    category: 'dinner',                     // coerced to "mains"
    ingredients: ['1 cup red lentils', { qty: 1, unit: 'tsp', item: 'cumin' }],
    steps: ['1. Simmer until they collapse.'],
    ...overrides,
  }, 'Annika');
}

beforeEach(() => localStorage.clear());

/* ---------------------------------------------------------------- basics --- */

test('saves a recipe and reads it back in the shape the app expects', async () => {
  const saved = await addRecipe();

  assert.ok(saved.id.startsWith('r_'));
  assert.equal(saved.title, 'Weeknight dal');
  assert.equal(saved.category, 'mains');
  assert.equal(saved.addedBy, 'Annika');
  assert.equal(saved.ingredients.length, 2);
  assert.equal(saved.ingredients[0].item, '1 cup red lentils');
  // Source numbering is stripped here exactly as it is on the server.
  assert.equal(saved.steps[0].text, 'Simmer until they collapse.');
  assert.deepEqual(saved.ratings, {});
  assert.equal(saved.timesCooked, 0);

  const { recipes } = await backend.loadAll();
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].title, 'Weeknight dal');
});

test('survives a reload — the blob is what persists, not memory', async () => {
  const { id } = await addRecipe();

  // A fresh import would re-read localStorage; getRecipe does the same thing.
  const again = await backend.getRecipe(id);
  assert.equal(again.title, 'Weeknight dal');
});

test('editing updates in place rather than duplicating', async () => {
  const saved = await addRecipe();
  await backend.saveRecipe({ ...saved, title: 'Really good dal' }, 'Annika');

  const { recipes } = await backend.loadAll();
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].title, 'Really good dal');
});

test('a missing recipe says so instead of returning undefined', async () => {
  await assert.rejects(() => backend.getRecipe('r_nope'), /isn't here any more/);
});

/* ------------------------------------------------- ratings, notes, cooks --- */

test('ratings are per person, and tapping the same star clears them', async () => {
  const { id } = await addRecipe();

  await backend.rate(id, 5, 'Annika');
  let recipe = await backend.rate(id, 3, 'Partner');
  assert.deepEqual(recipe.ratings, { Annika: 5, Partner: 3 });

  recipe = await backend.rate(id, 0, 'Annika');
  assert.deepEqual(recipe.ratings, { Partner: 3 });
});

test('notes and cooks attach to the recipe and to the calendar', async () => {
  const { id } = await addRecipe();

  await backend.addNote(id, 'Needed 10 more minutes.', 'Annika');
  const recipe = await backend.logCook(id, { date: TODAY, note: 'Too salty' }, 'Annika');

  assert.equal(recipe.notes.length, 1);
  assert.equal(recipe.notes[0].person, 'Annika');
  assert.equal(recipe.timesCooked, 1);
  assert.equal(recipe.lastCooked, TODAY);

  const { cooks } = await backend.loadAll();
  assert.equal(cooks.length, 1);
  assert.equal(cooks[0].title, 'Weeknight dal');
  assert.equal(cooks[0].recipeGone, false);
});

test('a cook needs a real date', async () => {
  const { id } = await addRecipe();
  await assert.rejects(() => backend.logCook(id, { date: 'yesterday' }, 'Annika'), /date like/);
});

test('deleting a recipe keeps the cook log, so the calendar stays truthful', async () => {
  const { id } = await addRecipe();
  await backend.logCook(id, { date: TODAY }, 'Annika');
  await backend.deleteRecipe(id);

  const { recipes, cooks } = await backend.loadAll();
  assert.equal(recipes.length, 0);
  assert.equal(cooks.length, 1);
  assert.equal(cooks[0].recipeGone, true);
  assert.equal(cooks[0].title, 'A deleted recipe');
});

/* --------------------------------------------------- pantry + suggestions --- */

test('the pantry updates rather than duplicating a thing you already have', async () => {
  await backend.addPantry({ name: 'Chicken thighs', location: 'fridge', qty: '6' }, 'Annika');
  let pantry = await backend.addPantry({ name: 'chicken thighs', location: 'freezer' }, 'Annika');

  assert.equal(pantry.length, 1);
  assert.equal(pantry[0].location, 'freezer');
  assert.equal(pantry[0].norm, 'chicken thigh');

  pantry = await backend.seedStaples('Annika');
  assert.ok(pantry.some((p) => p.name === 'salt' && p.staple));
});

test('suggestions rank by how much of a recipe you already have', async () => {
  await addRecipe();                                   // lentils + cumin
  await backend.saveRecipe({
    title: 'Buttered toast',
    ingredients: ['2 slices bread', '1 tbsp butter'],
    steps: ['Toast it.'],
  }, 'Annika');

  await backend.addPantry({ name: 'bread' }, 'Annika');
  await backend.seedStaples('Annika');                 // butter is a staple

  const { suggestions, pantrySize } = await backend.suggest();
  assert.ok(pantrySize > 0);

  // Toast is fully covered; the dal isn't, and says what's missing.
  assert.equal(suggestions[0].recipe.title, 'Buttered toast');
  assert.equal(suggestions[0].coverage, 1);
  assert.deepEqual(suggestions[0].missing, []);

  const dal = suggestions.find((s) => s.recipe.title === 'Weeknight dal');
  assert.ok(dal.missing.includes('1 cup red lentils'));
});

test('clearing the pantry keeps the staples', async () => {
  await backend.seedStaples('Annika');
  await backend.addPantry({ name: 'Spinach', location: 'fridge' }, 'Annika');

  const pantry = await backend.clearPantry();
  assert.ok(pantry.every((p) => p.staple));
  assert.ok(!pantry.some((p) => p.name === 'Spinach'));
});

/* ------------------------------------------------------------ portability --- */

test('a backup round-trips, and restoring merges instead of clobbering', async () => {
  const { id } = await addRecipe();
  await backend.rate(id, 5, 'Annika');
  await backend.logCook(id, { date: TODAY }, 'Annika');
  const backup = backend.exportAll();

  // A second device, with a recipe of its own.
  localStorage.clear();
  await backend.saveRecipe({ title: 'Other device recipe', ingredients: ['x'], steps: ['y'] }, 'Partner');

  const { added } = backend.importAll(backup);
  assert.equal(added, 1);

  const { recipes, cooks } = await backend.loadAll();
  assert.equal(recipes.length, 2, 'both devices’ recipes survive');
  assert.equal(cooks.length, 1);
  assert.equal(recipes.find((r) => r.id === id).ratings.Annika, 5);
});

test('restoring the same backup twice adds nothing the second time', async () => {
  await addRecipe();
  const backup = backend.exportAll();

  backend.importAll(backup);
  const second = backend.importAll(backup);
  assert.equal(second.added, 0);
  assert.equal((await backend.loadAll()).recipes.length, 1);
});

test('a newer copy of a recipe wins over an older one', async () => {
  const saved = await addRecipe();
  const backup = backend.exportAll();

  // The same recipe, edited later somewhere else.
  backup.recipes[0] = { ...saved, title: 'Edited elsewhere', updatedAt: '2099-01-01T00:00:00.000Z' };
  backend.importAll(backup);

  const { recipes } = await backend.loadAll();
  assert.equal(recipes[0].title, 'Edited elsewhere');
});

test('a file that is not a backup is refused', () => {
  assert.throws(() => backend.importAll({ hello: 'world' }), /isn't a Kitchen backup/);
  assert.throws(() => backend.importAll(null), /isn't a Kitchen backup/);
});

/* ------------------------------------------------------------- the photo --- */

test('a photo id rides along on a recipe and on a cook', async () => {
  const saved = await backend.saveRecipe({
    title: 'Dal', ingredients: ['lentils'], steps: ['Simmer.'], photoId: 'ph_dish',
  }, 'Annika');
  assert.equal(saved.photoId, 'ph_dish');

  // Saving without mentioning the photo must not wipe it.
  const edited = await backend.saveRecipe({ ...saved, photoId: undefined, title: 'Good dal' }, 'Annika');
  assert.equal(edited.photoId, 'ph_dish', 'an edit that ignores the photo keeps it');

  // Explicit null removes it.
  const cleared = await backend.saveRecipe({ ...saved, photoId: null }, 'Annika');
  assert.equal(cleared.photoId, null);

  const withCook = await backend.logCook(saved.id, { date: TODAY, photoId: 'ph_cook' }, 'Annika');
  assert.equal(withCook.cooks[0].photoId, 'ph_cook');

  // The calendar prefers the cook's own photo over the recipe's.
  const { cooks } = await backend.loadAll();
  assert.equal(cooks[0].photoId, 'ph_cook');
});

test('a cook with no photo of its own falls back to the recipe\u2019s', async () => {
  const saved = await backend.saveRecipe({
    title: 'Dal', ingredients: ['lentils'], steps: ['Simmer.'], photoId: 'ph_dish',
  }, 'Annika');
  await backend.logCook(saved.id, { date: TODAY }, 'Annika');

  const { cooks } = await backend.loadAll();
  assert.equal(cooks[0].photoId, 'ph_dish');
});

/* ------------------------------------------------------------- signing in --- */

test('signing in is just a name, and it is remembered', async () => {
  const { person } = await backend.signIn(null, '  Annika  ');
  assert.equal(person, 'Annika');

  const session = await backend.session();
  assert.equal(session.person, 'Annika');
  assert.ok(session.categories.length > 0);

  await backend.signOut();
  assert.equal((await backend.session()).person, null);
});
