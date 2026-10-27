/**
 * The Claude reader, minus Claude.
 *
 * The request itself can't run here — it needs a key and costs money — so
 * these cover the two ends we own: what gets sent, and turning what comes back
 * into the same draft shape the parser produces, so the editor never has to
 * know which one read the recipe.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toDraft, buildContent, RECIPE_SCHEMA } from '../public/js/backends/claude.js';
import { CATEGORY_IDS } from '../public/js/util/recipe.js';

test('a full answer becomes an editor draft', () => {
  const draft = toDraft({
    found: true,
    title: '  Lemon Garlic Chicken ',
    description: null,
    category: 'mains',
    cuisine: '',
    servings: 4,
    servingsUnit: 'servings',
    prepMin: 15,
    cookMin: 40,
    ingredients: [
      { qty: 6, unit: null, item: 'chicken thighs', note: 'bone-in, skin on', group: null },
      { qty: 3, unit: 'clove', item: 'garlic', note: 'minced', group: 'For the sauce' },
      { qty: null, unit: null, item: '  ', note: null, group: null },
    ],
    steps: [
      { text: 'Heat the oven to 200C.', group: null },
      { text: '', group: null },
    ],
    tags: ['quick', ''],
    sourceNote: null,
    doubts: null,
  });

  assert.equal(draft.title, 'Lemon Garlic Chicken');
  assert.equal(draft.cuisine, null);
  assert.equal(draft.ingredients.length, 2, 'blank ingredient dropped');
  assert.deepEqual(draft.ingredients[1], {
    qty: 3, unit: 'clove', item: 'garlic', note: 'minced', group: 'For the sauce',
  });
  assert.deepEqual(draft.steps, [{ text: 'Heat the oven to 200C.', group: null }]);
  assert.deepEqual(draft.tags, ['quick']);
  assert.equal(draft.found, true);
});

test('nothing recipe-like comes back as not found, not a crash', () => {
  const draft = toDraft({ found: false, ingredients: [], steps: [], tags: [] });
  assert.equal(draft.found, false);
  assert.equal(draft.category, 'mains');

  assert.equal(toDraft(null).found, false);
});

test('quantities that are not real numbers come out blank, never guessed', () => {
  const draft = toDraft({
    found: true,
    servings: -2,
    ingredients: [{ qty: Number.NaN, unit: 'cup', item: 'flour', note: null, group: null }],
    steps: [{ text: 'Mix.', group: null }],
  });
  assert.equal(draft.servings, null);
  assert.equal(draft.ingredients[0].qty, null);
});

test('an unknown category falls back to mains', () => {
  assert.equal(toDraft({ category: 'brunch-ish' }).category, 'mains');
});

test('images go before the text, and text-only still works', () => {
  const content = buildContent({
    text: '2 eggs\nWhisk.',
    images: [{ media_type: 'image/jpeg', data: 'AAAA' }],
  });
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.data, 'AAAA');
  assert.equal(content.at(-1).type, 'text');
  assert.match(content.at(-1).text, /2 eggs/);

  const imagesOnly = buildContent({ images: [{ media_type: 'image/jpeg', data: 'B' }] });
  assert.match(imagesOnly.at(-1).text, /images/);

  const textOnly = buildContent({ text: 'Toast. Butter it.' });
  assert.equal(textOnly.length, 1);
});

test('the schema offers exactly the app categories and requires every field', () => {
  assert.deepEqual(RECIPE_SCHEMA.properties.category.enum, CATEGORY_IDS);
  assert.deepEqual(
    [...RECIPE_SCHEMA.required].sort(),
    Object.keys(RECIPE_SCHEMA.properties).sort(),
  );
  const ingredient = RECIPE_SCHEMA.properties.ingredients.items;
  assert.deepEqual([...ingredient.required].sort(), Object.keys(ingredient.properties).sort());
});
