/**
 * The whole recipe box, on this device.
 *
 * This is what runs when there's no server — on GitHub Pages, or opened from a
 * file. Everything the Worker does with SQL, this does with one JSON blob in
 * localStorage, in the same shapes, so a backup taken here opens on a server
 * later and vice versa.
 *
 * Two honest limits, both consequences of there being nowhere to put shared
 * data: your phone and your partner's phone keep separate boxes, and importing
 * from photos or links can't happen, because reading a screenshot needs an API
 * key that can't live in code anyone can view, and fetching a recipe site from
 * a browser is blocked by that site's CORS policy.
 */

import { newId, nowIso, str, text } from '../util/clean.js';
import {
  CATEGORIES, LOCATIONS, DEFAULT_STAPLES, SOURCE_TYPES,
  coerceCategory, normaliseRecipe,
} from '../util/recipe.js';
import { normalise, covered } from '../util/match.js';

const KEY = 'kitchen.v1';
const PERSON_KEY = 'kitchen.person';

const LISTS = ['recipes', 'cooks', 'ratings', 'notes', 'pantry'];

/**
 * A brand-new empty box.
 *
 * This has to be a function, not a shared constant. Spreading one constant
 * would hand every caller the *same* arrays, so a write into a box that
 * started empty would quietly accumulate in module state — and if the write to
 * localStorage then failed, the app would go on showing a recipe that was
 * never actually saved, until a reload lost it without a word.
 */
function empty() {
  return { version: 1, recipes: [], cooks: [], ratings: [], notes: [], pantry: [] };
}

/** Thrown for the things this backend genuinely cannot do. */
export class UnavailableError extends Error {
  constructor(message) {
    super(message);
    this.status = 501;
  }
}

/* ------------------------------------------------------------- the blob --- */

function read() {
  const box = empty();
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return box; // storage blocked; the app still runs, it just won't persist
  }
  if (!raw) return box;

  try {
    const data = JSON.parse(raw);
    // Tolerate a partial or hand-edited blob rather than losing the lot.
    for (const key of LISTS) {
      if (Array.isArray(data[key])) box[key] = data[key];
    }
    return box;
  } catch {
    return box;
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || err?.code === 22) {
      throw new Error("This device's storage is full. Download a backup from Settings, then delete some recipes.");
    }
    throw new Error("Couldn't save to this device. If you're in a private window, storage is blocked there.");
  }
  return data;
}

function mutate(fn) {
  const data = read();
  const result = fn(data);
  write(data);
  return result;
}

/* --------------------------------------------------------- enrichment --- */

/** Add the ratings, cook count and last-cooked date the list view expects. */
function enrich(recipe, data) {
  const cooks = data.cooks.filter((c) => c.recipeId === recipe.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    ...recipe,
    ratings: Object.fromEntries(
      data.ratings.filter((r) => r.recipeId === recipe.id).map((r) => [r.person, r.stars]),
    ),
    timesCooked: cooks.length,
    lastCooked: cooks[0]?.date || null,
  };
}

function full(recipe, data) {
  return {
    ...enrich(recipe, data),
    notes: data.notes.filter((n) => n.recipeId === recipe.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    cooks: data.cooks.filter((c) => c.recipeId === recipe.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((c) => ({ id: c.id, date: c.date, by: c.by, note: c.note })),
  };
}

function find(data, id) {
  const recipe = data.recipes.find((r) => r.id === id);
  if (!recipe) throw new Error("That recipe isn't here any more.");
  return recipe;
}

/* ------------------------------------------------------------ backend --- */

export const backend = {
  mode: 'local',

  async session() {
    let person = null;
    try {
      person = localStorage.getItem(PERSON_KEY);
    } catch { /* storage blocked; they'll be asked for a name each time */ }

    return {
      person,
      configured: true,
      canImport: false,
      local: false,
      offline: true,
      categories: CATEGORIES,
      locations: LOCATIONS,
    };
  },

  // There's no passcode when there's nothing to protect — the data never
  // leaves this device. All that's wanted is a name to put on ratings.
  async signIn(_passcode, person) {
    const name = str(person, 40) || 'me';
    try {
      localStorage.setItem(PERSON_KEY, name);
    } catch { /* they'll just be asked again next time */ }
    return { person: name };
  },

  async signOut() {
    try {
      localStorage.removeItem(PERSON_KEY);
    } catch { /* nothing to undo */ }
  },

  async loadAll() {
    const data = read();
    return {
      recipes: data.recipes.map((r) => enrich(r, data))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      cooks: data.cooks.map((c) => {
        const recipe = data.recipes.find((r) => r.id === c.recipeId);
        return {
          id: c.id,
          recipeId: c.recipeId,
          date: c.date,
          by: c.by,
          note: c.note,
          title: recipe?.title || 'A deleted recipe',
          category: recipe?.category || 'mains',
          image: null,
          recipeGone: !recipe,
        };
      }).sort((a, b) => b.date.localeCompare(a.date)),
      pantry: [...data.pantry].sort((a, b) =>
        a.location.localeCompare(b.location) || a.name.localeCompare(b.name)),
    };
  },

  async getRecipe(id) {
    const data = read();
    return full(find(data, id), data);
  },

  async saveRecipe(input, person) {
    const clean = normaliseRecipe(input);
    const ts = nowIso();

    return mutate((data) => {
      const fields = {
        ...clean,
        category: coerceCategory(input.category ?? clean.category),
        servingsUnit: clean.servings_unit,
        prepMin: clean.prep_min,
        cookMin: clean.cook_min,
        sourceType: SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : 'manual',
        sourceUrl: input.sourceUrl || null,
        sourceName: str(input.sourceName, 120),
        sourceNote: clean.source_note,
        image: null,
        updatedAt: ts,
      };
      // The stored shape uses the API's camelCase names, not the SQL ones.
      delete fields.servings_unit;
      delete fields.prep_min;
      delete fields.cook_min;
      delete fields.source_note;

      if (input.id) {
        const existing = find(data, input.id);
        Object.assign(existing, fields);
        return full(existing, data);
      }

      const recipe = {
        id: newId('r'),
        ...fields,
        addedBy: person || 'me',
        createdAt: ts,
      };
      data.recipes.unshift(recipe);
      return full(recipe, data);
    });
  },

  async deleteRecipe(id) {
    mutate((data) => {
      data.recipes = data.recipes.filter((r) => r.id !== id);
      data.ratings = data.ratings.filter((r) => r.recipeId !== id);
      data.notes = data.notes.filter((n) => n.recipeId !== id);
      // Cooks are kept on purpose, so the calendar can still say what you ate.
    });
  },

  async rate(id, stars, person) {
    return mutate((data) => {
      find(data, id);
      data.ratings = data.ratings.filter((r) => !(r.recipeId === id && r.person === person));
      if (stars >= 1 && stars <= 5) {
        data.ratings.push({ recipeId: id, person, stars, updatedAt: nowIso() });
      }
      return full(find(data, id), data);
    });
  },

  async addNote(id, body, person) {
    const note = text(body, 2000);
    if (!note) throw new Error('An empty note has nothing to say.');

    return mutate((data) => {
      find(data, id);
      data.notes.push({
        id: newId('n'), recipeId: id, person, body: note, createdAt: nowIso(),
      });
      return full(find(data, id), data);
    });
  },

  async deleteNote(noteId) {
    mutate((data) => { data.notes = data.notes.filter((n) => n.id !== noteId); });
  },

  async logCook(id, { date, note }, person) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      throw new Error('A cook needs a date like 2026-09-16.');
    }
    return mutate((data) => {
      find(data, id);
      data.cooks.push({
        id: newId('c'),
        recipeId: id,
        date,
        by: person || 'me',
        note: text(note, 500),
        createdAt: nowIso(),
      });
      return full(find(data, id), data);
    });
  },

  async deleteCook(cookId) {
    mutate((data) => { data.cooks = data.cooks.filter((c) => c.id !== cookId); });
  },

  async addPantry(item, person) {
    const name = str(item.name, 80);
    if (!name) throw new Error('That item needs a name.');
    const norm = normalise(name) || name.toLowerCase();

    mutate((data) => {
      const existing = data.pantry.find((p) => p.norm === norm);
      const fields = {
        name,
        norm,
        location: LOCATIONS.includes(item.location) ? item.location : 'pantry',
        qty: str(item.qty, 40),
        staple: Boolean(item.staple),
        addedBy: person || 'me',
        updatedAt: nowIso(),
      };
      // Adding something you already have updates it rather than duplicating.
      if (existing) Object.assign(existing, fields);
      else data.pantry.push({ id: newId('p'), ...fields });
    });
    return (await this.loadAll()).pantry;
  },

  async deletePantry(id) {
    mutate((data) => { data.pantry = data.pantry.filter((p) => p.id !== id); });
    return (await this.loadAll()).pantry;
  },

  async clearPantry() {
    mutate((data) => { data.pantry = data.pantry.filter((p) => p.staple); });
    return (await this.loadAll()).pantry;
  },

  async seedStaples(person) {
    mutate((data) => {
      for (const name of DEFAULT_STAPLES) {
        const norm = normalise(name) || name;
        const existing = data.pantry.find((p) => p.norm === norm);
        if (existing) existing.staple = true;
        else {
          data.pantry.push({
            id: newId('p'),
            name,
            norm,
            location: 'pantry',
            qty: null,
            staple: true,
            addedBy: person || 'me',
            updatedAt: nowIso(),
          });
        }
      }
    });
    return (await this.loadAll()).pantry;
  },

  /** The same ranking the server does, run here instead. */
  async suggest(category) {
    const data = read();
    const pantryNorms = data.pantry.map((p) => p.norm).filter(Boolean);

    const scored = data.recipes
      .filter((r) => !category || r.category === category)
      .map((recipe) => {
        const have = [];
        const missing = [];
        for (const ing of recipe.ingredients || []) {
          (covered(ing.item, pantryNorms) ? have : missing).push(ing.item);
        }
        const total = have.length + missing.length;
        return {
          recipe: enrich(recipe, data),
          coverage: total ? have.length / total : 0,
          have: have.length,
          missing,
          total,
        };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => {
        if (b.coverage !== a.coverage) return b.coverage - a.coverage;
        // Ties break toward whatever you haven't cooked in longest.
        return (a.recipe.lastCooked || '').localeCompare(b.recipe.lastCooked || '');
      })
      .slice(0, 40);

    return { suggestions: scored, pantrySize: pantryNorms.length };
  },

  /* ------------------------------------------------------- not possible --- */

  async importPhotos() {
    throw new UnavailableError(
      'Reading photos needs a server — the key that does the reading can’t live in a public web page. '
      + 'Type the recipe in for now, or put it on a server later and this turns on.',
    );
  },

  async importLink() {
    throw new UnavailableError(
      "A browser isn't allowed to fetch another site's pages, so importing links needs a server. "
      + 'Copy the recipe text and use "Paste some text" instead.',
    );
  },

  async importText() {
    throw new UnavailableError(
      'Reading pasted text into a recipe needs a server. Use "Type it in" — it takes about a minute.',
    );
  },

  /* ---------------------------------------------------------- portability --- */

  exportAll() {
    return { exportedAt: nowIso(), ...read() };
  },

  /**
   * Restore a backup. Merges rather than replaces, keeping whichever copy of a
   * recipe was edited more recently, so restoring onto a device that already
   * has recipes doesn't throw either side away.
   */
  importAll(incoming) {
    if (!incoming || typeof incoming !== 'object') throw new Error("That file isn't a Kitchen backup.");
    if (!LISTS.some((k) => Array.isArray(incoming[k]))) {
      throw new Error("That file isn't a Kitchen backup — it has no recipes in it.");
    }

    return mutate((data) => {
      let added = 0;

      for (const recipe of incoming.recipes || []) {
        if (!recipe?.id) continue;
        const existing = data.recipes.find((r) => r.id === recipe.id);
        if (!existing) {
          data.recipes.push(recipe);
          added += 1;
        } else if ((recipe.updatedAt || '') > (existing.updatedAt || '')) {
          Object.assign(existing, recipe);
        }
      }

      const mergeById = (key) => {
        const seen = new Set(data[key].map((row) => row.id));
        for (const row of incoming[key] || []) {
          if (row?.id && !seen.has(row.id)) data[key].push(row);
        }
      };
      mergeById('cooks');
      mergeById('notes');
      mergeById('pantry');

      for (const rating of incoming.ratings || []) {
        if (!rating?.recipeId || !rating.person) continue;
        const existing = data.ratings.find(
          (r) => r.recipeId === rating.recipeId && r.person === rating.person,
        );
        if (!existing) data.ratings.push(rating);
        else if ((rating.updatedAt || '') > (existing.updatedAt || '')) existing.stars = rating.stars;
      }

      return { added, total: data.recipes.length };
    });
  },
};
