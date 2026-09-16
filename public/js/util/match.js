/**
 * Matching "3 cloves garlic, finely minced" against a cupboard that says "garlic".
 *
 * This file is imported by *both* halves of the app — the browser uses it to
 * dot the ingredients you already have, and the Worker bundles it to rank
 * suggestions. Keeping one copy is what stops the two from ever disagreeing
 * about whether you can make something.
 */

/** Words describing how an ingredient was prepared, not what it is. */
const PREP_WORDS = new Set([
  'finely', 'coarsely', 'roughly', 'thinly', 'thickly', 'freshly', 'lightly',
  'chopped', 'minced', 'diced', 'sliced', 'grated', 'shredded', 'crushed',
  'peeled', 'seeded', 'trimmed', 'halved', 'quartered', 'cubed', 'julienned',
  'melted', 'softened', 'beaten', 'whisked', 'drained', 'rinsed', 'toasted',
  'cooked', 'uncooked', 'raw', 'frozen', 'thawed', 'canned', 'jarred', 'dried',
  'packed', 'sifted', 'divided', 'optional', 'plus', 'more', 'extra', 'taste',
  'room', 'temperature', 'large', 'small', 'medium', 'ripe', 'fresh', 'good',
  'quality', 'about', 'approximately', 'torn', 'stemmed', 'zested', 'juiced',
  'pitted', 'cored', 'deveined', 'boneless', 'skinless', 'into', 'inch',
  'pieces', 'wedges', 'strips', 'rounds', 'cut', 'or', 'and', 'a', 'an',
  'the', 'of', 'to', 'for', 'if', 'as', 'needed', 'your', 'such', 'very',
]);

const UNIT_WORDS = new Set([
  'g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds', 'ml', 'millilitre', 'millilitres', 'milliliter',
  'milliliters', 'l', 'litre', 'litres', 'liter', 'liters', 'tsp', 'teaspoon',
  'teaspoons', 'tbsp', 'tablespoon', 'tablespoons', 'cup', 'cups', 'pinch',
  'pinches', 'dash', 'handful', 'handfuls', 'clove', 'cloves', 'can', 'cans',
  'tin', 'tins', 'jar', 'jars', 'package', 'packages', 'packet', 'packets',
  'bunch', 'bunches', 'sprig', 'sprigs', 'stalk', 'stalks', 'head', 'heads',
  'slice', 'slices', 'piece', 'pieces', 'stick', 'sticks', 'quart', 'quarts',
  'pint', 'pints', 'gallon', 'gallons', 'ct', 'count',
]);

/**
 * Reduce an ingredient line to the thing you'd look for in a cupboard.
 * "2 tbsp extra-virgin olive oil" -> "olive oil"; "3 large eggs, beaten" -> "egg".
 */
export function normalise(raw) {
  let s = String(raw || '').toLowerCase();

  // Parentheticals are asides — a metric conversion, "(about 2 cups)". Remove
  // them wherever they sit; splitting at the "(" would throw away the actual
  // ingredient in "1/2 cup (120ml) whole milk".
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/, ' ');
  s = s.split(',')[0];                                  // drop ", finely chopped"
  s = s.replace(/[¼-¾⅐-⅞]/g, ' ');  // ½ ⅓ ¼ …
  s = s.replace(/[0-9]+([./][0-9]+)?/g, ' ');
  s = s.replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ');

  const words = s.split(/\s+/).filter(Boolean)
    .filter((w) => !UNIT_WORDS.has(w) && !PREP_WORDS.has(w) && w.length > 1);

  // Singularise conservatively — "tomatoes" -> "tomato", but never "molasses".
  return words.map((w) => {
    if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
    if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('ss') || w.endsWith('us')) return w;
    if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
    return w;
  }).join(' ').trim();
}

/**
 * Is this ingredient covered by anything in the pantry?
 *
 * Containment either way, on purpose: "chicken thigh" is satisfied by
 * "chicken", and "chicken" is satisfied by "chicken thighs". Over-matching is
 * the right failure — a wrong suggestion costs a glance, a missed one costs
 * the feature.
 */
export function covered(ingredientName, pantryNorms) {
  const norm = normalise(ingredientName);
  if (!norm) return false;
  return pantryNorms.some((p) => p && (norm === p || norm.includes(p) || p.includes(norm)));
}
