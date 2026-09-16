/**
 * Turning a pasted block of text into a recipe, in the browser.
 *
 * No model and no server: recipe text carries strong, boring signals, and
 * reading them is what this does. "Ingredients:" and "Method:" headings when
 * they exist; when they don't, ingredient lines are short and start with a
 * quantity, and step lines are long and start with a verb — so the text can be
 * cut at the point where one stops looking like the other.
 *
 * It will get messy input partly wrong, and that's designed for: the result
 * opens in the editor, never straight into the box. Being roughly right in a
 * form you can fix beats being unavailable.
 *
 * The one rule it never breaks: nothing is invented. A quantity that wasn't in
 * the text comes out null, not guessed.
 */

/* ------------------------------------------------------------- vocabulary --- */

const UNITS = new Map(Object.entries({
  g: 'g', gram: 'g', grams: 'g', gm: 'g', gs: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', cc: 'ml',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', t: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', tb: 'tbsp', T: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', tin: 'tin', tins: 'tin',
  jar: 'jar', jars: 'jar',
  packet: 'packet', packets: 'packet', package: 'package', packages: 'package', pkg: 'packet',
  bunch: 'bunch', bunches: 'bunch',
  sprig: 'sprig', sprigs: 'sprig',
  stalk: 'stalk', stalks: 'stalk', stick: 'stick', sticks: 'stick',
  head: 'head', heads: 'head',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  handful: 'handful', handfuls: 'handful',
  drop: 'drop', drops: 'drop',
  knob: 'knob', bulb: 'bulb', rasher: 'rasher', rashers: 'rasher',
  fillet: 'fillet', fillets: 'fillet',
  sheet: 'sheet', sheets: 'sheet',
}));

/** Written-out numbers, which recipes use for small counts. */
const WORD_NUMBERS = new Map(Object.entries({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, dozen: 12,
}));

const VULGAR = new Map(Object.entries({
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}));

/** Verbs a step tends to open with. Recipes are written in the imperative. */
const STEP_VERBS = new Set([
  'heat', 'preheat', 'add', 'stir', 'mix', 'combine', 'cook', 'bake', 'roast',
  'simmer', 'boil', 'fry', 'saute', 'sauté', 'season', 'serve', 'pour', 'whisk',
  'fold', 'knead', 'chop', 'slice', 'dice', 'mince', 'remove', 'place', 'put',
  'transfer', 'cover', 'uncover', 'reduce', 'drain', 'rinse', 'garnish', 'let',
  'allow', 'leave', 'set', 'bring', 'return', 'repeat', 'divide', 'spread',
  'sprinkle', 'top', 'arrange', 'grease', 'line', 'beat', 'blend', 'process',
  'rest', 'cool', 'chill', 'freeze', 'reheat', 'turn', 'flip', 'toss', 'drizzle',
  'squeeze', 'taste', 'adjust', 'meanwhile', 'once', 'when', 'while', 'using',
  'in', 'wash', 'peel', 'trim', 'cut', 'crush', 'scatter', 'tip', 'lower',
  'increase', 'continue', 'discard', 'reserve', 'melt', 'warm', 'toast', 'grill',
  'steam', 'poach', 'marinate', 'refrigerate', 'assemble', 'finish', 'check',
]);

const HEADING = {
  ingredients: /^\s*(?:\*{0,2})\s*(ingredients?|you(?:'| )?ll need|what you need|shopping list|for the .+)\s*:?\s*(?:\*{0,2})\s*$/i,
  steps: /^\s*(?:\*{0,2})\s*(instructions?|method|directions?|steps|preparation|how to (?:make|cook) it|to (?:make|cook|serve))\s*:?\s*(?:\*{0,2})\s*$/i,
  notes: /^\s*(?:\*{0,2})\s*(notes?|tips?|to serve|variations?|storage|make ahead)\s*:?\s*(?:\*{0,2})\s*$/i,
};

/* ---------------------------------------------------------------- numbers --- */

/** "1 1/2", "1½", "½", "2.5", "2-3", "two" -> { value, upTo, rest }. */
function leadingQuantity(line) {
  let s = line;
  let value = null;
  let upTo = null;

  // Split a unicode fraction off a preceding digit: "1½" -> "1 ½"
  s = s.replace(/(\d)\s*([¼-¾⅐-⅞])/g, '$1 $2');

  const number = () => {
    // Unicode fraction
    let m = /^([¼-¾⅐-⅞])/.exec(s);
    if (m) { s = s.slice(m[0].length); return VULGAR.get(m[1]) ?? null; }

    // "1 1/2" — whole plus fraction
    m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(s);
    if (m) { s = s.slice(m[0].length); return Number(m[1]) + Number(m[2]) / Number(m[3]); }

    // "1 ½"
    m = /^(\d+)\s+([¼-¾⅐-⅞])/.exec(s);
    if (m) { s = s.slice(m[0].length); return Number(m[1]) + (VULGAR.get(m[2]) ?? 0); }

    // "3/4"
    m = /^(\d+)\s*\/\s*(\d+)/.exec(s);
    if (m) { s = s.slice(m[0].length); return Number(m[1]) / Number(m[2]); }

    // "2", "2.5", "1,5"
    m = /^(\d+(?:[.,]\d+)?)/.exec(s);
    if (m) { s = s.slice(m[0].length); return Number(m[1].replace(',', '.')); }

    return null;
  };

  value = number();

  if (value === null) {
    // "two onions", "a pinch of salt" — but not "One-Pot", where "One" is
    // part of a compound word rather than a count. Requiring whitespace after
    // it is what tells those apart.
    const m = /^([a-z]+)(?=\s|$)/i.exec(s);
    const word = m && WORD_NUMBERS.get(m[1].toLowerCase());
    if (word !== undefined && word !== null) {
      // Only treat a bare article as a quantity when a unit follows ("a pinch
      // of salt"); otherwise "a good tomato" would become "1 good tomato".
      const after = s.slice(m[0].length).trim().split(/\s+/)[0] || '';
      const isArticle = /^(a|an)$/i.test(m[1]);
      if (!isArticle || UNITS.has(after.toLowerCase().replace(/[^a-z]/g, ''))) {
        s = s.slice(m[0].length);
        value = word;
      }
    }
  }

  if (value === null) return { value: null, upTo: null, rest: line };

  // Ranges: "2-3", "2 to 3"
  const range = /^\s*(?:-|–|—|to\b)\s*/i.exec(s);
  if (range) {
    const after = s.slice(range[0].length);
    const saved = s;
    s = after;
    const second = number();
    if (second !== null) upTo = second;
    else s = saved;
  }

  return { value, upTo, rest: s };
}

function takeUnit(text) {
  const m = /^\s*([a-zA-Z]+)\b\.?/.exec(text);
  if (!m) return { unit: null, rest: text };

  const key = m[1].toLowerCase();
  // "T" means tablespoon but "t" means teaspoon — case matters for those two
  // alone, and only when written as a bare letter.
  const canonical = (m[1] === 'T' && UNITS.get('T')) || UNITS.get(key);
  if (!canonical) return { unit: null, rest: text };

  let rest = text.slice(m[0].length);
  rest = rest.replace(/^\s*(?:of\b)\s*/i, '');   // "2 cups of flour"
  return { unit: canonical, rest };
}

/* ------------------------------------------------------------ classifying --- */

const INGREDIENT_HINT = /\b(g|kg|ml|l|oz|lb|tsp|tbsp|cup|cups|clove|cloves|can|tin|pinch|handful|slice|slices|sprig|bunch|stick|packet|piece)\b/i;

function looksLikeIngredient(line) {
  if (!line) return 0;
  let score = 0;

  const { value, rest } = leadingQuantity(line);
  if (value !== null) score += 3;
  if (INGREDIENT_HINT.test(line)) score += 2;
  if (line.length < 60) score += 1;
  if (line.length < 40) score += 1;
  if (/^[-*•·–]\s+/.test(line)) score += 2;          // a bullet list
  if (!/[.!?]\s+\S/.test(line)) score += 1;          // not multiple sentences
  if (value !== null && rest.trim().split(/\s+/).length <= 6) score += 1;

  return score;
}

function looksLikeStep(line) {
  if (!line) return 0;
  let score = 0;

  const bare = line.replace(/^\s*(?:step\s*)?\d{1,2}\s*[.):]\s*/i, '');
  if (bare !== line) score += 4;                     // explicitly numbered

  const first = (bare.match(/^[a-zA-Z]+/) || [''])[0].toLowerCase();
  if (STEP_VERBS.has(first)) score += 3;

  if (line.length > 80) score += 3;
  else if (line.length > 55) score += 1;
  if (/[.!?]\s+\S/.test(line)) score += 2;           // several sentences
  if (/\b(minutes?|mins?|hours?|until|degrees|°|°C|°F|gas mark)\b/i.test(line)) score += 1;

  return score;
}

/* ---------------------------------------------------------------- pieces --- */

function parseIngredientLine(raw, group) {
  let line = raw.replace(/^\s*[-*•·–]\s+/, '').trim();
  if (!line) return null;

  const { value, upTo, rest } = leadingQuantity(line);
  const { unit, rest: afterUnit } = value === null
    ? { unit: null, rest: rest }
    : takeUnit(rest);

  let body = afterUnit.trim().replace(/^[,;]\s*/, '');

  // "flour, sifted" — everything after the first comma is preparation, not the
  // thing itself, which is what makes pantry matching work.
  let note = null;
  const comma = body.indexOf(',');
  if (comma > 0) {
    note = body.slice(comma + 1).trim() || null;
    body = body.slice(0, comma).trim();
  }

  // A trailing parenthetical is a note too: "milk (or oat milk)".
  const paren = /\s*\(([^)]*)\)\s*$/.exec(body);
  if (paren) {
    note = [paren[1].trim(), note].filter(Boolean).join(', ');
    body = body.slice(0, paren.index).trim();
  }

  if (!body) return null;

  if (upTo !== null) note = [`up to ${upTo}`, note].filter(Boolean).join(', ');

  return {
    qty: value,
    unit,
    item: body.replace(/\s+/g, ' '),
    note: note || null,
    group: group || null,
  };
}

function parseStepLine(raw, group) {
  const text = raw
    .replace(/^\s*[-*•·–]\s+/, '')
    .replace(/^\s*(?:step\s*)?\d{1,2}\s*[.):]\s*/i, '')
    .trim();
  return text ? { text, group: group || null } : null;
}

/** "Serves 4", "Prep: 20 mins", "Makes 12 cookies", "Total time 1 hr 10 min". */
function readMetadata(line, out) {
  const lower = line.toLowerCase();

  const yieldMatch = /\b(?:serves|servings?|yield|makes|feeds)\b\s*:?\s*(\d+(?:\s*(?:[-–]|to)\s*\d+)?)\s*([a-z]+)?/i.exec(line);
  if (yieldMatch) {
    out.servings = Number(/^\d+/.exec(yieldMatch[1])[0]);
    const unit = (yieldMatch[2] || '').toLowerCase();
    // "makes 12 cookies" names what it makes; "serves 4" doesn't.
    if (unit && !['people', 'person', 'servings', 'serving', 'portions', 'portion'].includes(unit)) {
      out.servingsUnit = unit;
    }
    return true;
  }

  const time = (label) => {
    const re = new RegExp(`\\b${label}[a-z]*\\s*(?:time)?\\s*:?\\s*((?:\\d+\\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\\b\\s*)+)`, 'i');
    const m = re.exec(line);
    if (!m) return null;
    let total = 0;
    for (const part of m[1].matchAll(/(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/gi)) {
      total += Number(part[1]) * (/^h/i.test(part[2]) ? 60 : 1);
    }
    return total || null;
  };

  const prep = time('prep') ?? time('active') ?? time('hands-on') ?? time('hands on');
  if (prep) { out.prepMin = prep; return true; }

  const cook = time('cook') ?? time('bak') ?? time('total') ?? bareTime(line);
  if (cook) { out.cookMin = cook; return true; }

  // A bare "45 minutes" line on its own is a cooking time.
  if (/^\s*\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b\s*$/i.test(lower) && !out.cookMin) {
    const m = /(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/i.exec(lower);
    out.cookMin = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1);
    return true;
  }

  return false;
}

/**
 * A line that is only a time — "Time: 45 minutes", "Total time 1 hr 10 min".
 * Anchored to the start so the word "time" inside a step can't be mistaken
 * for the recipe's own timing.
 */
function bareTime(line) {
  const m = /^\s*(?:total\s+)?time\s*:?\s*((?:\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b\s*)+)$/i.exec(line);
  if (!m) return null;
  let total = 0;
  for (const part of m[1].matchAll(/(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/gi)) {
    total += Number(part[1]) * (/^h/i.test(part[2]) ? 60 : 1);
  }
  return total || null;
}

/* ------------------------------------------------------------------ main --- */

/**
 * Parse pasted text into something recipe-shaped.
 * Always returns an object; `confident` says whether it found enough to be
 * worth trusting without a careful read.
 */
export function parseRecipeText(input) {
  const raw = String(input || '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n').map((l) => l.replace(/\s+$/, ''));

  const out = {
    title: null,
    description: null,
    servings: null,
    servingsUnit: null,
    prepMin: null,
    cookMin: null,
    ingredients: [],
    steps: [],
    tags: [],
    sourceNote: null,
  };

  /* Pass 1 — pull out headings and metadata, keep everything else in order. */
  const body = [];
  let section = null;              // 'ingredients' | 'steps' | 'notes' | null
  let group = null;
  let sawHeading = false;
  const noteLines = [];

  let pendingMarker = null;

  for (const rawLine of lines) {
    let text = rawLine.trim();
    if (!text) { body.push({ blank: true }); continue; }

    // Some sites put "Step 1" on its own line and the instruction under it.
    if (/^step\s*\d{1,2}\s*:?$/i.test(text)) { pendingMarker = text; continue; }
    if (pendingMarker) { text = `${pendingMarker}. ${text}`; pendingMarker = null; }

    if (HEADING.ingredients.test(text)) {
      sawHeading = true;
      section = 'ingredients';
      // "For the sauce:" is both a heading and a group label.
      const sub = /^\s*\*{0,2}\s*(for the .+?)\s*:?\s*\*{0,2}\s*$/i.exec(text);
      group = sub ? sub[1].replace(/\s+/g, ' ') : null;
      continue;
    }
    if (HEADING.steps.test(text)) { sawHeading = true; section = 'steps'; group = null; continue; }
    if (HEADING.notes.test(text)) { sawHeading = true; section = 'notes'; group = null; continue; }

    if (section === 'notes') { noteLines.push(text); continue; }

    // A short line ending in a colon inside a list is a group label.
    if (section && /^[^.!?]{2,40}:$/.test(text) && !leadingQuantity(text).value) {
      group = text.replace(/:$/, '').trim();
      continue;
    }

    body.push({ text, section, group, beforeHeadings: !sawHeading });
  }

  /* Pass 2 — title and metadata from the top of the text. */
  let index = 0;
  while (index < body.length && body[index].blank) index += 1;

  if (index < body.length && !body[index].section) {
    const candidate = body[index].text;
    if (looksLikeTitle(candidate)) {
      out.title = candidate.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
      index += 1;
    }
  }

  const rest = body.slice(index).filter((l) => !l.blank);

  const remaining = [];
  for (const line of rest) {
    if (!line.section && readMetadata(line.text, out)) continue;
    remaining.push(line);
  }

  /* Pass 3 — assign lines to ingredients or steps. */
  const explicit = remaining.filter((l) => l.section);
  const intro = [];

  if (sawHeading && explicit.length) {
    for (const line of remaining) {
      // Prose above the first heading is the author telling you about their
      // weekend. It is not an ingredient, and guessing that it is puts junk at
      // the top of the list where it is most annoying.
      if (line.beforeHeadings && !line.section) {
        intro.push(line.text);
        continue;
      }
      if (line.section === 'steps') {
        const step = parseStepLine(line.text, line.group);
        if (step) out.steps.push(step);
      } else if (line.section === 'ingredients') {
        const ing = parseIngredientLine(line.text, line.group);
        if (ing) out.ingredients.push(ing);
      } else if (out.steps.length) {
        const step = parseStepLine(line.text, line.group);
        if (step) out.steps.push(step);
      } else {
        const ing = parseIngredientLine(line.text, line.group);
        if (ing) out.ingredients.push(ing);
      }
    }
  } else {
    // No headings: find where the short quantity-ish lines stop and the long
    // instruction-ish ones start, and cut there.
    const texts = remaining.map((l) => l.text);
    const split = bestSplit(texts);

    texts.forEach((text, i) => {
      if (i < split) {
        const ing = parseIngredientLine(text, remaining[i].group);
        if (ing) out.ingredients.push(ing);
      } else {
        const step = parseStepLine(text, remaining[i].group);
        if (step) out.steps.push(step);
      }
    });
  }

  if (intro.length) {
    const blurb = intro.join(' ').replace(/\s+/g, ' ').trim();
    if (blurb.length > 20) out.description = blurb.slice(0, 600);
  }

  if (noteLines.length) out.sourceNote = noteLines.join('\n');

  // A single blob of prose with no line breaks is one "step" — split it into
  // sentences so it's followable.
  if (!out.ingredients.length && out.steps.length === 1 && out.steps[0].text.length > 200) {
    const sentences = out.steps[0].text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
    if (sentences.length > 1) out.steps = sentences.map((text) => ({ text, group: null }));
  }

  out.confident = out.ingredients.length > 0 && out.steps.length > 0;

  if (!out.confident) {
    out.sourceNote = [
      out.ingredients.length ? null : "Couldn't pick out an ingredient list.",
      out.steps.length ? null : "Couldn't pick out any steps.",
      out.sourceNote,
    ].filter(Boolean).join(' ');
  }

  return out;
}

/**
 * Is this first line the name of the dish, or the first line of a paragraph?
 *
 * Blog recipes open with the author's preamble, and taking a sentence of that
 * as the title is worse than having no title at all — it's wrong in the one
 * place you see on every screen. Titles are short, aren't sentences, and don't
 * carry quantities.
 */
function looksLikeTitle(line) {
  const text = line.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
  if (!text || text.length > 70) return false;
  if (text.split(/\s+/).length > 10) return false;
  if (/[.!?]\s/.test(text)) return false;              // more than one sentence
  if (/[,;:]$/.test(text)) return false;                // a clause, continuing
  if (readMetadata(text, {})) return false;             // "Serves 4"
  if (leadingQuantity(text).value !== null) return false;
  // A lone sentence ending in a full stop is prose, unless it's very short.
  if (/\.$/.test(text) && text.split(/\s+/).length > 4) return false;
  return true;
}

/**
 * Where does the ingredient list end and the method begin?
 *
 * Every possible cut is scored by how much it disagrees with the lines on each
 * side — step-like lines above the cut and ingredient-like lines below it both
 * count against it — and the cheapest cut wins.
 */
function bestSplit(texts) {
  if (!texts.length) return 0;

  const ing = texts.map(looksLikeIngredient);
  const step = texts.map(looksLikeStep);

  let best = 0;
  let bestCost = Infinity;

  for (let cut = 0; cut <= texts.length; cut += 1) {
    let cost = 0;
    for (let i = 0; i < cut; i += 1) cost += Math.max(0, step[i] - ing[i]);
    for (let i = cut; i < texts.length; i += 1) cost += Math.max(0, ing[i] - step[i]);
    if (cost < bestCost) { bestCost = cost; best = cut; }
  }

  return best;
}
