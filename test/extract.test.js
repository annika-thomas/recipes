/**
 * Tests for the parts of importing that don't involve a model.
 *
 * These are the pieces that quietly rot: every recipe site emits schema.org
 * slightly differently, and a change here shows up as a recipe with no steps
 * rather than as an error. Run with `npm test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recipeFromJsonLd } from '../worker/extract/jsonld.js';
import { readableText, meta, pageTitle, parseUrl } from '../worker/extract/page.js';
import { socialPlatform, captionLooksThin } from '../worker/extract/social.js';
import { normaliseRecipe, coerceCategory } from '../worker/lib/recipeSchema.js';
import { normalise, covered } from '../public/js/util/match.js';

const page = (jsonLd) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;

/* ------------------------------------------------------------- JSON-LD --- */

test('reads a plain schema.org Recipe', () => {
  const found = recipeFromJsonLd(page({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Classic lasagne',
    description: 'A proper one.',
    recipeYield: '6 servings',
    prepTime: 'PT30M',
    cookTime: 'PT1H30M',
    recipeCategory: 'Main course',
    recipeCuisine: 'Italian',
    recipeIngredient: ['500g beef mince', '2 tbsp olive oil'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Brown the mince.' },
      { '@type': 'HowToStep', text: 'Layer it up.' },
    ],
    keywords: 'pasta, comfort food',
    image: 'https://example.com/lasagne.jpg',
    author: { '@type': 'Person', name: 'Someone' },
  }));

  assert.ok(found);
  assert.equal(found.recipe.title, 'Classic lasagne');
  assert.equal(found.recipe.servings, 6);
  assert.equal(found.recipe.prep_min, 30);
  assert.equal(found.recipe.cook_min, 90);
  assert.equal(found.recipe.cuisine, 'Italian');
  assert.equal(found.recipe.ingredients.length, 2);
  assert.equal(found.recipe.steps.length, 2);
  assert.equal(found.recipe.steps[0].text, 'Brown the mince.');
  assert.deepEqual(found.recipe.tags, ['pasta', 'comfort food']);
  assert.equal(found.imageUrl, 'https://example.com/lasagne.jpg');
  assert.equal(found.sourceName, 'Someone');
  assert.equal(found.recipe.confident, true);
});

test('finds a Recipe nested in an @graph', () => {
  const found = recipeFromJsonLd(page({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'A food blog' },
      { '@type': 'WebPage', name: 'A page' },
      {
        '@type': ['Recipe', 'NewsArticle'],
        name: 'Panzanella',
        recipeIngredient: ['Stale bread', 'Tomatoes'],
        recipeInstructions: 'Tear the bread. Toss it with the tomatoes.',
      },
    ],
  }));

  assert.ok(found);
  assert.equal(found.recipe.title, 'Panzanella');
  // A single instruction string gets split into steps at sentence boundaries.
  assert.equal(found.recipe.steps.length, 2);
  assert.equal(found.recipe.steps[1].text, 'Toss it with the tomatoes.');
});

test('keeps HowToSection headings as step groups', () => {
  const found = recipeFromJsonLd(page({
    '@type': 'Recipe',
    name: 'Two-part thing',
    recipeIngredient: ['Flour'],
    recipeInstructions: [
      {
        '@type': 'HowToSection',
        name: 'For the sauce',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Soften the onion.' },
          { '@type': 'HowToStep', text: 'Add the tomatoes.' },
        ],
      },
      {
        '@type': 'HowToSection',
        name: 'To assemble',
        itemListElement: [{ '@type': 'HowToStep', text: 'Put it together.' }],
      },
    ],
  }));

  assert.equal(found.recipe.steps.length, 3);
  assert.equal(found.recipe.steps[0].group, 'For the sauce');
  assert.equal(found.recipe.steps[2].group, 'To assemble');
});

test('handles a top-level array of JSON-LD objects', () => {
  const found = recipeFromJsonLd(page([
    { '@type': 'Organization', name: 'Publisher' },
    { '@type': 'Recipe', name: 'Soup', recipeIngredient: ['Stock'], recipeInstructions: ['Heat it through.'] },
  ]));
  assert.equal(found.recipe.title, 'Soup');
});

test('decodes entities and strips markup inside JSON-LD', () => {
  const found = recipeFromJsonLd(page({
    '@type': 'Recipe',
    name: 'Mac &amp; cheese',
    recipeIngredient: ['<span>200g</span> macaroni', '&frac12; tsp mustard'],
    recipeInstructions: [{ '@type': 'HowToStep', text: '<p>Boil the pasta.</p>' }],
  }));

  assert.equal(found.recipe.title, 'Mac & cheese');
  assert.equal(found.recipe.ingredients[0].item, '200g macaroni');
  assert.equal(found.recipe.ingredients[1].item, '1/2 tsp mustard');
  assert.equal(found.recipe.steps[0].text, 'Boil the pasta.');
});

test('falls back to totalTime when there is no cookTime', () => {
  const found = recipeFromJsonLd(page({
    '@type': 'Recipe', name: 'X', totalTime: 'PT2H15M',
    recipeIngredient: ['Y'], recipeInstructions: ['Z.'],
  }));
  assert.equal(found.recipe.cook_min, 135);
});

test('a Recipe with no ingredients is not a usable recipe', () => {
  assert.equal(recipeFromJsonLd(page({ '@type': 'Recipe', name: 'Stub page' })), null);
});

test('flags a recipe that has ingredients but no steps', () => {
  const found = recipeFromJsonLd(page({
    '@type': 'Recipe', name: 'Half a recipe', recipeIngredient: ['Salt'],
  }));
  assert.equal(found.recipe.confident, false);
  assert.match(found.recipe.source_note, /no steps/i);
});

test('survives malformed JSON-LD and pages without any', () => {
  assert.equal(recipeFromJsonLd('<script type="application/ld+json">{ not json </script>'), null);
  assert.equal(recipeFromJsonLd('<html><body>Just a page.</body></html>'), null);
});

/* ---------------------------------------------------------------- page --- */

test('readableText drops scripts and keeps list structure', () => {
  const text = readableText(`
    <html><head><style>.a{color:red}</style></head>
    <body>
      <nav>Home About</nav>
      <script>var tracking = 1;</script>
      <h1>Brownies</h1>
      <ul><li>200g chocolate</li><li>3 eggs</li></ul>
      <p>Melt the chocolate.</p>
      <footer>Copyright</footer>
    </body></html>`);

  assert.ok(!text.includes('tracking'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('Home About'));
  assert.ok(text.includes('Brownies'));
  assert.ok(text.includes('- 200g chocolate'));
  assert.ok(text.includes('Melt the chocolate.'));
});

test('meta reads OpenGraph tags in either attribute order', () => {
  assert.equal(meta('<meta property="og:title" content="A pie">', 'og:title'), 'A pie');
  assert.equal(meta('<meta content="A pie" name="og:title">', 'og:title'), 'A pie');
  assert.equal(meta('<meta property="og:site_name" content="Food &amp; Co">', 'og:site_name'), 'Food & Co');
  assert.equal(meta('<html></html>', 'og:title'), null);
});

test('pageTitle prefers og:title and falls back to <title>', () => {
  assert.equal(pageTitle('<title>Fallback</title>'), 'Fallback');
  assert.equal(pageTitle('<meta property="og:title" content="Better"><title>Fallback</title>'), 'Better');
});

test('parseUrl refuses private and non-http targets', () => {
  assert.equal(parseUrl('https://example.com/r').hostname, 'example.com');
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://192.168.1.4/x',
    'http://10.0.0.5/x', 'http://172.16.3.1/x', 'file:///etc/passwd', 'not a url']) {
    assert.throws(() => parseUrl(bad), undefined, `should have refused ${bad}`);
  }
});

/* -------------------------------------------------------------- social --- */

test('recognises the platforms it can read', () => {
  assert.equal(socialPlatform(new URL('https://www.tiktok.com/@user/video/123')), 'tiktok');
  assert.equal(socialPlatform(new URL('https://vm.tiktok.com/abc/')), 'tiktok');
  assert.equal(socialPlatform(new URL('https://www.instagram.com/reel/abc/')), 'instagram');
  assert.equal(socialPlatform(new URL('https://youtu.be/abc')), 'youtube');
  assert.equal(socialPlatform(new URL('https://www.bbcgoodfood.com/r/x')), null);
});

test('spots a caption with no recipe in it', () => {
  assert.equal(captionLooksThin('Recipe in my bio!! 🔥🔥 #pasta #foodtok #easyrecipes'), true);
  assert.equal(captionLooksThin(
    'CREAMY TOMATO PASTA\n400g rigatoni\n2 tbsp olive oil\n1 can chopped tomatoes\n'
    + '200ml double cream\nBoil the pasta. Fry the garlic. Stir it all together.',
  ), false);
});

/* ------------------------------------------------------- normalisation --- */

test('normaliseRecipe accepts both string and object ingredients', () => {
  const recipe = normaliseRecipe({
    title: '  Roast   chicken ',
    ingredients: ['1 whole chicken', { quantity: '2', unit: 'tbsp', name: 'butter', note: 'softened' }],
    instructions: ['1. Heat the oven.', { text: 'Step 2: Roast it.' }],
    tags: ['Sunday', 'sunday', ''],
  });

  assert.equal(recipe.title, 'Roast chicken');
  assert.equal(recipe.ingredients[0].item, '1 whole chicken');
  assert.equal(recipe.ingredients[1].qty, 2);
  assert.equal(recipe.ingredients[1].item, 'butter');
  // Numbering that came with the source is stripped; the UI supplies its own.
  assert.equal(recipe.steps[0].text, 'Heat the oven.');
  assert.equal(recipe.steps[1].text, 'Roast it.');
  assert.deepEqual(recipe.tags, ['sunday']);
});

test('normaliseRecipe never throws on junk', () => {
  const recipe = normaliseRecipe({ ingredients: 'not an array', steps: null, servings: 'lots' });
  assert.equal(recipe.title, 'Untitled recipe');
  assert.deepEqual(recipe.ingredients, []);
  assert.equal(recipe.servings, null);
});

test('coerceCategory maps what sites actually write', () => {
  assert.equal(coerceCategory('Main Course'), 'mains');
  assert.equal(coerceCategory('dinner'), 'mains');
  assert.equal(coerceCategory('Dessert'), 'desserts');
  assert.equal(coerceCategory('Salad'), 'soups');
  assert.equal(coerceCategory('Cocktail'), 'drinks');
  assert.equal(coerceCategory('breakfast'), 'breakfast');
  assert.equal(coerceCategory('wildly unexpected'), 'mains');
});

/* ------------------------------------------------------------ matching --- */

test('normalise reduces an ingredient line to the thing itself', () => {
  // "extra" is a filler word, so it goes; what matters is that "olive oil" survives.
  assert.equal(normalise('2 tbsp extra-virgin olive oil'), 'virgin olive oil');
  assert.equal(covered('2 tbsp extra-virgin olive oil', ['olive oil']), true);
  assert.equal(normalise('3 cloves garlic, finely minced'), 'garlic');
  assert.equal(normalise('1/2 cup (120ml) whole milk'), 'whole milk');
  assert.equal(normalise('3 large eggs, beaten'), 'egg');
  assert.equal(normalise('500g ripe tomatoes'), 'tomato');
  assert.equal(normalise('Salt and pepper to taste'), 'salt pepper');
  // A mid-line parenthetical is an aside, not the end of the ingredient.
  assert.equal(normalise('1 can (400g) chopped tomatoes, drained'), 'tomato');
});

test('covered matches a cupboard against a recipe both ways round', () => {
  const pantry = ['chicken', 'garlic', 'olive oil', 'lemon'];
  assert.equal(covered('6 bone-in chicken thighs', pantry), true);
  assert.equal(covered('2 cloves garlic, crushed', pantry), true);
  assert.equal(covered('1 lemon, zested and juiced', pantry), true);
  assert.equal(covered('200g crème fraîche', pantry), false);
  assert.equal(covered('', pantry), false);
  assert.equal(covered('anything', []), false);
});

test('covered matches when the cupboard is more specific than the recipe', () => {
  assert.equal(covered('chicken', ['chicken thigh']), true);
});
