/**
 * Turning messy input into a recipe.
 *
 * Everything that isn't already structured — a screenshot, a reel caption, the
 * text of a blog post that buried the recipe under someone's holiday — goes
 * through here. The model is pinned to a JSON schema, so what comes back is
 * either a recipe-shaped object or an error, never prose we have to parse.
 */

import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './http.js';
import { CATEGORY_IDS } from './recipeSchema.js';

/**
 * The contract. Every field is required and explicitly nullable, because strict
 * JSON schema mode has no notion of "optional" — the model says `null` when it
 * doesn't know, which is exactly what we want it to do instead of inventing a
 * cooking time.
 */
const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title', 'description', 'category', 'cuisine', 'servings', 'servings_unit',
    'prep_min', 'cook_min', 'ingredients', 'steps', 'tags', 'confident', 'source_note',
  ],
  properties: {
    title: { type: 'string', description: 'The name of the dish as written. Never invent a cute name.' },
    description: { type: ['string', 'null'], description: 'One or two sentences, only if the source gives them.' },
    category: { type: 'string', enum: CATEGORY_IDS },
    cuisine: { type: ['string', 'null'], description: 'e.g. Italian, Thai. Null if not obvious.' },
    servings: { type: ['number', 'null'] },
    servings_unit: { type: ['string', 'null'], description: '"servings", "cookies", "loaf".' },
    prep_min: { type: ['integer', 'null'] },
    cook_min: { type: ['integer', 'null'] },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['qty', 'unit', 'item', 'note', 'group'],
        properties: {
          qty: { type: ['number', 'null'], description: 'Decimal. 1/2 becomes 0.5. Null when the source says "to taste".' },
          unit: { type: ['string', 'null'], description: 'As written: g, cup, tbsp, clove.' },
          item: { type: 'string', description: 'The ingredient itself, without the quantity.' },
          note: { type: ['string', 'null'], description: 'Prep or substitution: "finely chopped", "or vegetable stock".' },
          group: { type: ['string', 'null'], description: 'Sub-heading like "For the sauce", when the recipe has them.' },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'group'],
        properties: {
          text: { type: 'string', description: 'One step. Keep the original wording and every temperature and time.' },
          group: { type: ['string', 'null'] },
        },
      },
    },
    tags: { type: 'array', items: { type: 'string' }, description: 'Up to 6 lowercase tags: vegetarian, quick, one-pot.' },
    confident: {
      type: 'boolean',
      description: 'False when the source was too partial to give a followable recipe.',
    },
    source_note: {
      type: ['string', 'null'],
      description: 'What was missing or unreadable, in one sentence. Null when the recipe came through whole.',
    },
  },
};

const SYSTEM = `You turn things people saved into recipes they can cook from.

Transcribe, never invent. If a quantity, time or temperature is not in the
source, the field is null — a null is useful, a plausible guess is dangerous.
Keep the original units and the original voice of the instructions; do not
convert grams to cups or rewrite steps into your own phrasing.

Split instructions into steps at the natural boundaries, one action or closely
related group of actions each. Keep sub-headings ("For the marinade") in the
group field of the ingredients and steps they cover.

When the source is a social video caption, the recipe is often written in a
compressed shorthand — "1 cup rice, 2 cups water, 20 min" — and there may be no
step text at all. Expand what is genuinely there into steps, but do not fill in
the parts the video showed and the caption did not. Say so in source_note and
set confident to false.

If the source is not a recipe at all, set confident to false, put the title as
best you can, and leave the ingredients and steps empty.`;

function client(env) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Recipe importing needs an Anthropic API key. Run: npx wrangler secret put ANTHROPIC_API_KEY');
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * One call, with the server-side refusal fallback switched on.
 *
 * A recipe is about the least likely thing to trip a safety classifier, but the
 * fallback costs nothing when it doesn't fire, and an import that quietly
 * returns nothing is a bad way to find out. If the account can't use the beta,
 * we retry once on the stable endpoint rather than failing the import.
 */
async function callModel(env, content) {
  const anthropic = client(env);
  const model = env.CLAUDE_MODEL || 'claude-opus-5';

  const params = {
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
  };

  let response;
  try {
    response = await anthropic.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    if (err?.status === 400) {
      response = await anthropic.messages.create(params);
    } else if (err?.status === 401) {
      throw new HttpError(503, 'Anthropic rejected that API key. Check ANTHROPIC_API_KEY.');
    } else if (err?.status === 429) {
      throw new HttpError(429, 'Anthropic is rate-limiting us. Try that import again in a minute.');
    } else {
      throw new HttpError(502, `Couldn't reach Claude to read that (${err?.message || 'unknown error'}).`);
    }
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, "Claude declined to read that one. If it's genuinely a recipe, try a screenshot instead.");
  }
  if (response.stop_reason === 'max_tokens') {
    throw new HttpError(422, 'That recipe was too long to read in one go. Try importing it in two halves.');
  }

  const raw = response.content.find((b) => b.type === 'text')?.text;
  if (!raw) throw new HttpError(502, 'Claude returned nothing readable for that.');

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(502, "Claude's answer wasn't valid JSON — try that import again.");
  }
}

/** Read one or more photos of a recipe. */
export async function recipeFromImages(env, images, hint) {
  if (!images.length) throw new HttpError(400, 'No photo came through.');

  const content = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
  }));

  content.push({
    type: 'text',
    text: [
      images.length > 1
        ? `These ${images.length} images are one recipe, in order. Read them together.`
        : 'Read the recipe in this image.',
      'It may be a cookbook page, a handwritten card, a screenshot of a website, or a phone screenshot of a social post.',
      hint ? `The person saving it added: ${hint}` : null,
    ].filter(Boolean).join('\n'),
  });

  return callModel(env, content);
}

/** Read a recipe out of text we scraped or the user pasted. */
export async function recipeFromText(env, { body, sourceLabel, url, hint }) {
  if (!body || body.trim().length < 20) {
    throw new HttpError(422, "There wasn't enough text there to build a recipe from.");
  }

  const content = [{
    type: 'text',
    text: [
      sourceLabel ? `Source: ${sourceLabel}` : null,
      url ? `URL: ${url}` : null,
      hint ? `The person saving it added: ${hint}` : null,
      '',
      'Text:',
      body.slice(0, 120_000),
    ].filter((line) => line !== null).join('\n'),
  }];

  return callModel(env, content);
}
