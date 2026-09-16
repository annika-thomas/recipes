/**
 * The whole recipe box, on this device.
 *
 * This is what runs when there's no server — on GitHub Pages, or opened from a
 * file. Everything the Worker does with SQL, this does with one JSON blob in
 * localStorage, in the same shapes, so a backup taken here opens on a server
 * later and vice versa.
 *
 * The one consequence of there being nowhere shared to put data: this device
 * and another one keep separate boxes. Backup and restore move recipes across.
 * Photos are the exception to "one JSON blob" — they live in IndexedDB, which
 * is sized for them; see backends/photos.js.
 */

import { newId, nowIso, str, text } from '../util/clean.js';
import {
  CATEGORIES, LOCATIONS, DEFAULT_STAPLES, SOURCE_TYPES,
  coerceCategory, normaliseRecipe,
} from '../util/recipe.js';
import { normalise, covered } from '../util/match.js';

const KEY = 'kitchen.v1';
const PERSON_KEY = 'kitchen.person';

/**
 * The last box that was known good, kept so one bad write can't be the end of
 * it. localStorage.setItem is atomic, but the JSON going into it is built from
 * whatever the app currently believes, and "the app currently believes
 * nothing" is a state a bug can reach. Keeping the previous copy means that
 * mistake costs one edit instead of the whole box.
 *
 * It is not protection against the browser clearing its storage: both keys
 * live in the same place and go together. That is what backup files are for.
 */
const PREV_KEY = 'kitchen.v1.prev';

/** When a backup file was last downloaded, so Settings can nag proportionately. */
const BACKUP_KEY = 'kitchen.backup.at';

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

/* ------------------------------------------------------------- the blob --- */

function get(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked; the app still runs, it just won't persist
  }
}

/** Turn stored JSON into a box, or null if it isn't one. */
function parse(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const box = empty();
    // Tolerate a partial or hand-edited blob rather than losing the lot.
    for (const key of LISTS) {
      if (Array.isArray(data[key])) box[key] = data[key];
    }
    return box;
  } catch {
    return null;
  }
}

function read() {
  const box = parse(get(KEY));
  if (box) return box;

  /*
    The main copy is missing or isn't JSON. An empty box that parsed fine is
    left alone — that's someone who deleted their last recipe, and resurrecting
    it would be worse than useless. This is only for the case where there is
    nothing readable at all, where falling back can only be an improvement.
  */
  const previous = parse(get(PREV_KEY));
  if (previous?.recipes.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(previous));
    } catch { /* still readable this session even if it can't be written back */ }
    return previous;
  }

  return empty();
}

function write(data) {
  const json = JSON.stringify(data);
  const previous = get(KEY);

  try {
    // Order matters: the old copy is banked before the new one lands, so a
    // failure here leaves both the stored box and its backstop untouched.
    if (previous && previous !== json) localStorage.setItem(PREV_KEY, previous);
  } catch { /* no room for a backstop; the real write still gets its chance */ }

  try {
    localStorage.setItem(KEY, json);
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || err?.code === 22) {
      // The backstop is the one thing here that can be spared, so spend it
      // rather than refusing the save.
      try {
        localStorage.removeItem(PREV_KEY);
        localStorage.setItem(KEY, json);
        return data;
      } catch { /* genuinely full */ }
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
      .map((c) => ({ id: c.id, date: c.date, by: c.by, note: c.note, photoId: c.photoId || null })),
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
          // A cook's own photo if it has one, else the recipe's.
          photoId: c.photoId || recipe?.photoId || null,
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
        // The picture is a blob in IndexedDB; the recipe only holds its id.
        photoId: input.photoId === undefined ? undefined : (input.photoId || null),
        updatedAt: ts,
      };
      // The stored shape uses the API's camelCase names, not the SQL ones.
      delete fields.servings_unit;
      delete fields.prep_min;
      delete fields.cook_min;
      delete fields.source_note;

      // `undefined` means "leave the photo alone"; null means "remove it".
      if (fields.photoId === undefined) delete fields.photoId;

      if (input.id) {
        const existing = find(data, input.id);
        Object.assign(existing, fields);
        return full(existing, data);
      }

      const recipe = {
        id: newId('r'),
        photoId: null,
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

  async logCook(id, { date, note, photoId }, person) {
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
        photoId: photoId || null,
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

  /* ---------------------------------------------------------- portability --- */

  exportAll() {
    return { exportedAt: nowIso(), ...read() };
  },

  /**
   * How much is in the box, without loading and enriching all of it.
   *
   * The gate uses this. Being asked your name when you know you had recipes
   * reads as "it lost everything", and most of the time it isn't — you signed
   * out, or switched who this device is. Saying what's still here turns a
   * frightening screen into a boring one.
   */
  summary() {
    const data = read();
    return { recipes: data.recipes.length, cooks: data.cooks.length };
  },

  /** When a backup file was last downloaded, or null if never. */
  lastBackup() {
    const raw = get(BACKUP_KEY);
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  },

  markBackedUp() {
    try {
      localStorage.setItem(BACKUP_KEY, nowIso());
    } catch { /* the backup still downloaded; only the reminder is lost */ }
  },

  /**
   * Is the backstop holding recipes this box no longer has?
   *
   * read() heals the unreadable case by itself. This is the other one: the
   * stored box parsed fine but has less in it than the copy behind it, which
   * is what a bad delete looks like. That can't be undone automatically —
   * deleting things is allowed — so it's offered in Settings instead.
   */
  recoverable() {
    const previous = parse(get(PREV_KEY));
    if (!previous?.recipes.length) return null;

    const current = parse(get(KEY)) || empty();
    const missing = previous.recipes.filter(
      (r) => r?.id && !current.recipes.some((c) => c.id === r.id),
    );
    return missing.length ? { count: missing.length } : null;
  },

  /** Put back whatever the backstop still has. Merges; nothing is overwritten. */
  recover() {
    const previous = parse(get(PREV_KEY));
    if (!previous?.recipes.length) throw new Error('There is nothing to put back.');
    return this.importAll(previous);
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
