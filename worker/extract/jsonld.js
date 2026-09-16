/**
 * Most recipe sites already publish their recipes as structured data.
 *
 * schema.org/Recipe in a <script type="application/ld+json"> block is how
 * Google builds those recipe cards, so nearly every food blog, NYT Cooking,
 * Serious Eats and BBC Good Food emit one. When we find it we get a perfect
 * recipe for free — right quantities, right steps, no model call, no cost.
 * That's why this runs before anything else.
 */

const SCRIPT_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&frac12;/g, '1/2')
    .replace(/&frac14;/g, '1/4')
    .replace(/&frac34;/g, '3/4')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Walk anything JSON-LD hands us — graphs, arrays, single objects — for a Recipe. */
function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipe(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => String(t).toLowerCase() === 'recipe')) return node;

  if (node['@graph']) return findRecipe(node['@graph'], depth + 1);
  for (const key of ['mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    if (node[key]) {
      const found = findRecipe(node[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** ISO 8601 durations ("PT1H30M") are what schema.org uses for times. */
function minutes(iso) {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(String(iso));
  if (!m) {
    const plain = /(\d+)\s*min/i.exec(String(iso));
    return plain ? Number(plain[1]) : null;
  }
  const total = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return total > 0 ? total : null;
}

function firstString(value) {
  if (!value) return null;
  if (typeof value === 'string') return stripTags(value);
  if (Array.isArray(value)) return firstString(value[0]);
  if (typeof value === 'object') return firstString(value.name || value.text || value.url || value['@id']);
  return null;
}

/**
 * Instructions come in four shapes in the wild: a string, an array of strings,
 * an array of HowToStep objects, or HowToSections containing steps. All four
 * appear on real sites, so all four are handled.
 */
function instructions(value, group = null, out = []) {
  if (!value) return out;

  if (typeof value === 'string') {
    const cleaned = stripTags(value);
    // A single blob of instructions — split on sentence-ish boundaries.
    const parts = cleaned.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim()).filter((s) => s.length > 8);
    for (const p of parts) out.push({ text: p, group });
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) instructions(item, group, out);
    return out;
  }
  if (typeof value === 'object') {
    const type = String(value['@type'] || '').toLowerCase();
    if (type === 'howtosection') {
      const name = firstString(value.name);
      instructions(value.itemListElement || value.steps, name || group, out);
      return out;
    }
    const step = stripTags(value.text || value.name || '');
    if (step) out.push({ text: step, group });
    return out;
  }
  return out;
}

function parseServings(value) {
  const s = firstString(value);
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : null;
}

function image(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return image(value[0]);
  if (typeof value === 'object') return image(value.url || value.contentUrl);
  return null;
}

/**
 * Pull a recipe out of a page's structured data.
 * Returns null — not an error — when the page has none, so the caller can
 * fall back to reading the page with Claude.
 */
export function recipeFromJsonLd(html) {
  SCRIPT_RE.lastIndex = 0;
  let match;

  while ((match = SCRIPT_RE.exec(html)) !== null) {
    let data;
    try {
      // Some sites emit JSON-LD with raw control characters inside strings.
      data = JSON.parse(match[1].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' '));
    } catch {
      continue;
    }

    const node = findRecipe(data);
    if (!node) continue;

    const steps = instructions(node.recipeInstructions);
    const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
      .map((line) => stripTags(line)).filter(Boolean)
      .map((line) => ({ qty: null, unit: null, item: line, note: null, group: null }));

    // A "recipe" with no ingredients is a stub page — let the model try instead.
    if (!ingredients.length) continue;

    const author = firstString(node.author);
    const publisher = firstString(node.publisher);

    return {
      recipe: {
        title: firstString(node.name) || 'Untitled recipe',
        description: firstString(node.description),
        category: firstString(node.recipeCategory) || '',
        cuisine: firstString(node.recipeCuisine),
        servings: parseServings(node.recipeYield),
        servings_unit: 'servings',
        prep_min: minutes(node.prepTime),
        cook_min: minutes(node.cookTime) ?? minutes(node.totalTime),
        ingredients,
        steps,
        tags: String(firstString(node.keywords) || '').split(',')
          .map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6),
        confident: steps.length > 0,
        source_note: steps.length ? null : 'The site listed ingredients but no steps — check the original.',
      },
      sourceName: publisher || author || null,
      imageUrl: image(node.image),
    };
  }

  return null;
}

export { stripTags, decodeEntities };
