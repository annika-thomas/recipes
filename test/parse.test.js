/**
 * The text parser, against the shapes recipes actually arrive in.
 *
 * These are all pasted-from-somewhere formats: a tidy blog recipe, a note with
 * no headings at all, a message from a friend, a scaled-down index card. The
 * parser is a heuristic, so the bar is "usable in the editor", not "perfect" —
 * but the ingredient/step split and the quantities have to be right, because
 * those are the parts nobody proofreads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRecipeText } from '../public/js/util/parseRecipe.js';

const items = (r) => r.ingredients.map((i) => i.item);
const steps = (r) => r.steps.map((s) => s.text);

/* ------------------------------------------------------- the tidy format --- */

test('a recipe with headings comes through whole', () => {
  const r = parseRecipeText(`
Lemon Garlic Chicken Thighs

Serves 4
Prep time: 15 minutes
Cook time: 40 minutes

Ingredients
6 bone-in chicken thighs, skin on
4 cloves garlic, finely minced
1 lemon
2 tbsp olive oil
Flaky salt and black pepper

Instructions
1. Preheat the oven to 200C.
2. Season the thighs all over with salt and pepper.
3. Roast for 40 minutes until the skin is crisp.
`);

  assert.equal(r.title, 'Lemon Garlic Chicken Thighs');
  assert.equal(r.servings, 4);
  assert.equal(r.prepMin, 15);
  assert.equal(r.cookMin, 40);

  assert.equal(r.ingredients.length, 5);
  assert.deepEqual(r.ingredients[0], {
    qty: 6, unit: null, item: 'bone-in chicken thighs', note: 'skin on', group: null,
  });
  assert.deepEqual(r.ingredients[1], {
    qty: 4, unit: 'clove', item: 'garlic', note: 'finely minced', group: null,
  });
  assert.equal(r.ingredients[3].unit, 'tbsp');
  assert.equal(r.ingredients[4].qty, null, 'no quantity is null, never a guess');

  assert.equal(r.steps.length, 3);
  assert.equal(steps(r)[0], 'Preheat the oven to 200C.', 'numbering is stripped');
  assert.equal(r.confident, true);
});

/* ---------------------------------------------------- no headings at all --- */

test('splits ingredients from method with no headings to help it', () => {
  const r = parseRecipeText(`
Overnight oats
1/2 cup rolled oats
150ml milk
1 tbsp maple syrup
a pinch of salt
Stir everything together in a jar.
Leave it in the fridge overnight.
In the morning, top with whatever fruit you have.
`);

  assert.equal(r.title, 'Overnight oats');
  assert.equal(r.ingredients.length, 4, `got ${JSON.stringify(items(r))}`);
  assert.equal(r.steps.length, 3, `got ${JSON.stringify(steps(r))}`);

  assert.equal(r.ingredients[0].qty, 0.5);
  assert.equal(r.ingredients[0].unit, 'cup');
  assert.equal(r.ingredients[1].qty, 150);
  assert.equal(r.ingredients[1].unit, 'ml');
  assert.equal(r.ingredients[3].qty, 1);
  assert.equal(r.ingredients[3].unit, 'pinch');
  assert.match(steps(r)[0], /^Stir everything/);
});

/* -------------------------------------------------------------- numbers --- */

test('reads quantities the way people write them', () => {
  const r = parseRecipeText(`
Test
1 1/2 cups flour
2½ tsp baking powder
¾ cup sugar
2-3 cloves garlic
2 to 3 tbsp water
1.5 kg potatoes
two onions
a pinch of saffron
Mix it all.
`);

  const q = r.ingredients.map((i) => [i.qty, i.unit, i.item]);
  assert.deepEqual(q[0], [1.5, 'cup', 'flour']);
  assert.deepEqual(q[1], [2.5, 'tsp', 'baking powder']);
  assert.deepEqual(q[2], [0.75, 'cup', 'sugar']);
  assert.deepEqual(q[3], [2, 'clove', 'garlic']);
  assert.match(r.ingredients[3].note, /up to 3/);
  assert.deepEqual(q[4], [2, 'tbsp', 'water']);
  assert.deepEqual(q[5], [1.5, 'kg', 'potatoes']);
  assert.deepEqual(q[6], [2, null, 'onions']);
  assert.deepEqual(q[7], [1, 'pinch', 'saffron']);
});

test('an article is only a quantity when a unit follows it', () => {
  const r = parseRecipeText(`
Test
a pinch of salt
a really good tomato
Chop it.
`);
  assert.equal(r.ingredients[0].qty, 1);
  assert.equal(r.ingredients[0].unit, 'pinch');
  // "a really good tomato" must not become "1 really good tomato".
  assert.equal(r.ingredients[1].qty, null);
  assert.match(r.ingredients[1].item, /really good tomato/);
});

test('handles "of" after a unit, and units written with a full stop', () => {
  const r = parseRecipeText(`
Test
2 cups of flour
1 tbsp. olive oil
Mix.
`);
  assert.deepEqual([r.ingredients[0].qty, r.ingredients[0].unit, r.ingredients[0].item], [2, 'cup', 'flour']);
  assert.deepEqual([r.ingredients[1].qty, r.ingredients[1].unit, r.ingredients[1].item], [1, 'tbsp', 'olive oil']);
});

/* --------------------------------------------------------------- groups --- */

test('keeps "For the ..." headings as groups on both lists', () => {
  const r = parseRecipeText(`
Lasagne

For the ragu:
500g beef mince
1 onion, diced

For the white sauce:
50g butter
50g flour
500ml milk

Method
Brown the mince with the onion.
Make a roux and whisk in the milk.
Layer it up and bake.
`);

  assert.equal(r.ingredients.length, 5);
  assert.equal(r.ingredients[0].group, 'For the ragu');
  assert.equal(r.ingredients[2].group, 'For the white sauce');
  assert.equal(r.steps.length, 3);
});

/* ------------------------------------------------------ bullets and junk --- */

test('strips bullets and markdown', () => {
  const r = parseRecipeText(`
# Tomato soup

**Ingredients**
- 1kg ripe tomatoes
* 2 cloves garlic
• 1 tbsp olive oil

**Method**
- Roast the tomatoes with the garlic.
- Blend until smooth.
`);

  assert.equal(r.title, 'Tomato soup');
  assert.deepEqual(items(r), ['ripe tomatoes', 'garlic', 'olive oil']);
  assert.equal(r.ingredients[0].qty, 1);
  assert.equal(r.ingredients[0].unit, 'kg');
  assert.deepEqual(steps(r), ['Roast the tomatoes with the garlic.', 'Blend until smooth.']);
});

test('a parenthetical becomes a note, not part of the ingredient', () => {
  const r = parseRecipeText(`
Test
250ml milk (or oat milk)
1 onion (finely chopped)
Cook it.
`);
  assert.equal(r.ingredients[0].item, 'milk');
  assert.equal(r.ingredients[0].note, 'or oat milk');
  assert.equal(r.ingredients[1].item, 'onion');
  assert.equal(r.ingredients[1].note, 'finely chopped');
});

/* --------------------------------------------------------------- yields --- */

test('reads what a recipe makes, and what it makes it of', () => {
  assert.equal(parseRecipeText('X\nServes 4\n1 egg\nCook.').servings, 4);
  assert.equal(parseRecipeText('X\nServes 4-6\n1 egg\nCook.').servings, 4);

  const cookies = parseRecipeText('X\nMakes 12 cookies\n1 egg\nBake.');
  assert.equal(cookies.servings, 12);
  assert.equal(cookies.servingsUnit, 'cookies');

  // "serves 4 people" shouldn't make the unit "people".
  assert.equal(parseRecipeText('X\nServes 4 people\n1 egg\nCook.').servingsUnit, null);
});

test('reads times in the forms recipes use', () => {
  assert.equal(parseRecipeText('X\nPrep: 20 mins\n1 egg\nCook.').prepMin, 20);
  assert.equal(parseRecipeText('X\nPrep time 1 hr 10 min\n1 egg\nCook.').prepMin, 70);
  assert.equal(parseRecipeText('X\nCook time: 1 hour\n1 egg\nCook.').cookMin, 60);
  assert.equal(parseRecipeText('X\nTotal time: 45 minutes\n1 egg\nCook.').cookMin, 45);
});

/* ------------------------------------------------------- awkward inputs --- */

test('a message from a friend, all on few lines', () => {
  const r = parseRecipeText(
    'that pasta thing\n'
    + '400g rigatoni, 2 tbsp olive oil, 1 tin chopped tomatoes, 200ml double cream\n'
    + 'Boil the pasta. Fry the garlic in the oil. Add the tomatoes and cream and simmer for 10 minutes. '
    + 'Stir it through the pasta and eat immediately.',
  );

  assert.equal(r.title, 'that pasta thing');
  // The comma-separated line is one "ingredient" — wrong in detail, but it
  // lands in the ingredient list where it can be split by hand, not lost.
  assert.ok(r.ingredients.length >= 1, 'the ingredients line is not discarded');
  assert.ok(r.steps.length >= 1, 'the method is not discarded');
  assert.ok(steps(r).join(' ').includes('Boil the pasta'));
});

test('a wall of prose is broken into sentences', () => {
  const r = parseRecipeText(
    'Scrambled eggs\n'
    + 'Beat three eggs with a splash of milk and a good pinch of salt. '
    + 'Melt butter in a cold pan and add the eggs. '
    + 'Stir constantly over a low heat until they are just set but still glossy. '
    + 'Take them off the heat a moment before you think they are done.',
  );

  assert.equal(r.title, 'Scrambled eggs');
  assert.ok(r.steps.length >= 3, `expected sentences to split, got ${r.steps.length}`);
});

test('says so when it could not find a recipe', () => {
  const r = parseRecipeText('just some thoughts about dinner really, nothing structured here');
  assert.equal(r.confident, false);
  assert.match(r.sourceNote, /Couldn't pick out/);
});

test('never throws, whatever it is given', () => {
  for (const input of ['', null, undefined, '\n\n\n', '🍅🍅🍅', 'x'.repeat(5000)]) {
    const r = parseRecipeText(input);
    assert.ok(Array.isArray(r.ingredients));
    assert.ok(Array.isArray(r.steps));
  }
});

/* ------------------------------------------------------------- the notes --- */

test('a notes section is kept but not turned into steps', () => {
  const r = parseRecipeText(`
Banana bread
Ingredients
3 ripe bananas
200g flour
Method
Mash the bananas.
Bake for 50 minutes.
Notes
Keeps for three days wrapped in foil.
Freezes well in slices.
`);

  assert.equal(r.steps.length, 2, 'notes must not become steps');
  assert.match(r.sourceNote, /Keeps for three days/);
  assert.match(r.sourceNote, /Freezes well/);
});

/* ------------------------------------------------------------- the title --- */

test('does not steal an ingredient line for the title', () => {
  const r = parseRecipeText(`
2 cups flour
1 tsp salt
300ml water
Mix and knead.
`);
  assert.equal(r.title, null, 'better no title than a wrong one');
  assert.equal(r.ingredients.length, 3);
});

/* ------------------------------------------------- the blog-recipe format --- */

test('ignores the author preamble above a blog recipe', () => {
  const r = parseRecipeText(`
Honestly this is the only weeknight curry I make anymore. It came from my
friend Priya and I have changed almost nothing.

Yield: 4 servings
Active time: 15 minutes
Total time: 35 minutes

INGREDIENTS
2 tablespoons neutral oil
1 large onion, thinly sliced
2 teaspoons garam masala
Kosher salt and black pepper, to taste

PREPARATION
Step 1
Heat the oil in a large skillet over medium-high heat.
Step 2
Add the onion and cook until deeply golden, 8 to 10 minutes.
`);

  // No title beats a title that is really the first line of a paragraph.
  assert.equal(r.title, null);
  assert.match(r.description, /only weeknight curry/);

  assert.equal(r.servings, 4);
  assert.equal(r.prepMin, 15, '"Active time" is prep time');
  assert.equal(r.cookMin, 35);

  assert.equal(r.ingredients.length, 4, `preamble leaked in: ${JSON.stringify(items(r))}`);
  assert.equal(r.ingredients[0].item, 'neutral oil');

  // "Step 1" on its own line belongs to the instruction beneath it.
  assert.equal(r.steps.length, 2, `got ${JSON.stringify(steps(r))}`);
  assert.equal(steps(r)[0], 'Heat the oil in a large skillet over medium-high heat.');
});

test('a title must look like a name, not a sentence', () => {
  const name = parseRecipeText('Lemon garlic chicken\n1 egg\nCook it.');
  assert.equal(name.title, 'Lemon garlic chicken');

  // Too long, several sentences, or trailing punctuation: all prose.
  for (const prose of [
    'I have been making this for years and it never fails me once.',
    'This is really good. You should try it.',
    'Something I wanted to say about dinner,',
  ]) {
    assert.equal(parseRecipeText(`${prose}\n1 egg\nCook it.`).title, null,
      `should have refused: ${prose}`);
  }
});

test('reads an ALL CAPS index card', () => {
  const r = parseRecipeText(`
GRANDMA'S CORNBREAD

1 C YELLOW CORNMEAL
1/4 C SUGAR
1 TBSP BAKING POWDER
1 EGG

MIX DRY INGREDIENTS.
ADD WET, STIR UNTIL JUST COMBINED.
BAKE AT 400 FOR 20-25 MIN.
`);

  assert.equal(r.title, "GRANDMA'S CORNBREAD");
  assert.equal(r.ingredients.length, 4);
  assert.deepEqual([r.ingredients[0].qty, r.ingredients[0].unit], [1, 'cup'], '"C" is cups');
  assert.deepEqual([r.ingredients[1].qty, r.ingredients[1].unit], [0.25, 'cup']);
  assert.equal(r.ingredients[3].unit, null, '"1 EGG" has no unit');
  assert.equal(r.steps.length, 3);
});
