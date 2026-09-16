/**
 * The database's view of a recipe.
 *
 * The shape itself — categories, what a valid recipe is, how a messy import is
 * cleaned up — lives in public/js/util/recipe.js, because the browser needs
 * exactly the same rules when it stores recipes on the device instead. This
 * file is only the part that is genuinely about SQL rows.
 */

export {
  CATEGORIES, CATEGORY_IDS, SOURCE_TYPES, categoryLabel, coerceCategory, normaliseRecipe,
} from '../../public/js/util/recipe.js';

export { normalise as normaliseIngredientName, covered } from '../../public/js/util/match.js';

/** Turn a stored row into the JSON the app consumes. */
export function rowToRecipe(row) {
  if (!row) return null;
  const parse = (value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    cuisine: row.cuisine,
    servings: row.servings,
    servingsUnit: row.servings_unit,
    prepMin: row.prep_min,
    cookMin: row.cook_min,
    ingredients: parse(row.ingredients, []),
    steps: parse(row.steps, []),
    tags: parse(row.tags, []),
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    sourceNote: row.source_note,
    image: row.image_key ? `/img/${row.image_key}` : null,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
