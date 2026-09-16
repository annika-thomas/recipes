/**
 * What a recipe is, and the one place that decides what's valid.
 *
 * Shared by both halves of the app. The Worker funnels every write through
 * `normaliseRecipe` on its way to the database; the browser funnels every write
 * through the same function on its way to localStorage. That's what lets the
 * same app run with a server behind it or with nothing behind it at all — a
 * recipe is the same shape either way, so a backup taken from one opens in the
 * other.
 */

import { str, text, num, int } from './clean.js';

export const CATEGORIES = [
  { id: 'breakfast',  label: 'Breakfast' },
  { id: 'lunch',      label: 'Lunch' },
  { id: 'mains',      label: 'Mains' },
  { id: 'appetizers', label: 'Appetizers' },
  { id: 'sides',      label: 'Sides' },
  { id: 'soups',      label: 'Soups & salads' },
  { id: 'baking',     label: 'Baking & bread' },
  { id: 'desserts',   label: 'Desserts' },
  { id: 'drinks',     label: 'Drinks' },
  { id: 'sauces',     label: 'Sauces & basics' },
  { id: 'snacks',     label: 'Snacks' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Where a pantry item lives. */
export const LOCATIONS = ['fridge', 'freezer', 'pantry', 'spices'];

/** Things nobody wants to tick off a list to get a sensible suggestion. */
export const DEFAULT_STAPLES = [
  'salt', 'pepper', 'olive oil', 'water', 'butter', 'sugar', 'flour',
];

export const SOURCE_TYPES = ['manual', 'photo', 'link', 'social'];

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || 'Mains';
}

function normaliseIngredient(raw) {
  if (typeof raw === 'string') {
    const line = text(raw, 300);
    if (!line) return null;
    return { qty: null, unit: null, item: line, note: null, group: null };
  }
  if (!raw || typeof raw !== 'object') return null;

  const item = text(raw.item ?? raw.name ?? raw.ingredient, 300);
  if (!item) return null;

  return {
    qty: num(raw.qty ?? raw.quantity ?? raw.amount, { min: 0, max: 100000 }),
    unit: str(raw.unit, 40),
    item,
    note: str(raw.note, 200),
    group: str(raw.group ?? raw.section, 80),
  };
}

function normaliseStep(raw, index) {
  const body = typeof raw === 'string' ? raw : (raw?.text ?? raw?.step ?? raw?.instruction);
  const cleaned = text(body, 2000);
  if (!cleaned) return null;
  // Scraped steps often arrive pre-numbered; the UI numbers them itself.
  const unnumbered = cleaned.replace(/^\s*(?:step\s*)?\d{1,2}[.):]\s*/i, '');
  return {
    text: unnumbered || cleaned,
    group: typeof raw === 'object' ? str(raw?.group ?? raw?.section, 80) : null,
    n: index + 1,
  };
}

/** Best-effort mapping of whatever the importer guessed onto a real category. */
export function coerceCategory(value) {
  const v = String(value || '').toLowerCase().trim();
  if (CATEGORY_IDS.includes(v)) return v;

  const aliases = {
    main: 'mains', dinner: 'mains', 'main course': 'mains', entree: 'mains',
    'main dish': 'mains', supper: 'mains',
    appetizer: 'appetizers', starter: 'appetizers', starters: 'appetizers',
    app: 'appetizers', snack: 'snacks', side: 'sides', 'side dish': 'sides',
    salad: 'soups', salads: 'soups', soup: 'soups', stew: 'soups',
    dessert: 'desserts', sweets: 'desserts', pudding: 'desserts',
    bread: 'baking', cake: 'baking', cookies: 'baking', pastry: 'baking',
    drink: 'drinks', cocktail: 'drinks', beverage: 'drinks', smoothie: 'drinks',
    sauce: 'sauces', condiment: 'sauces', dressing: 'sauces', basics: 'sauces',
    brunch: 'breakfast',
  };
  return aliases[v] || 'mains';
}

/**
 * Take anything recipe-shaped and return a stored record's worth of fields.
 * Throws nothing — a thin recipe is better than a rejected one, and the editor
 * lets you fix whatever the importer got wrong.
 */
export function normaliseRecipe(input = {}) {
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map(normaliseIngredient).filter(Boolean).slice(0, 120);

  const steps = (Array.isArray(input.steps ?? input.instructions) ? (input.steps ?? input.instructions) : [])
    .map(normaliseStep).filter(Boolean).slice(0, 80)
    .map((s, i) => ({ ...s, n: i + 1 }));

  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .map((t) => str(t, 40)).filter(Boolean)
    .map((t) => t.toLowerCase()).slice(0, 12);

  return {
    title: str(input.title, 200) || 'Untitled recipe',
    description: text(input.description, 1200),
    category: coerceCategory(input.category),
    cuisine: str(input.cuisine, 60),
    servings: num(input.servings, { min: 0, max: 500 }),
    servings_unit: str(input.servings_unit ?? input.servingsUnit, 40) || 'servings',
    prep_min: int(input.prep_min ?? input.prepMin, { min: 0, max: 100000 }),
    cook_min: int(input.cook_min ?? input.cookMin, { min: 0, max: 100000 }),
    ingredients,
    steps,
    tags: [...new Set(tags)],
    source_note: text(input.source_note ?? input.sourceNote, 3000),
  };
}

