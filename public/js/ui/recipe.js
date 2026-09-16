/**
 * One recipe, open.
 *
 * The page is built for the moment you're actually standing at the counter:
 * scale first, ingredients you can tick off, steps you can tick off, and the
 * "we made this" button where your thumb already is. Ratings and notes live
 * below, because they're for afterwards.
 */

import { el, svg } from '../util/dom.js';
import { ICONS, emojiFor } from './icons.js';
import {
  state, recipeById, fetchRecipe, rate, addNote, removeNote,
  logCook, removeCook, removeRecipe,
} from '../store.js';
import {
  formatAmount, formatMinutes, formatYield, formatQty,
  formatDate, relativeDate, todayKey, pluralise,
} from '../util/format.js';
import { stars, categoryTag, spinner, iconButton, field, textarea } from './bits.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { openEditor } from './editor.js';
import { openCookMode } from './cookmode.js';
import { covered } from '../util/match.js';

/** Per-recipe view state — scale and what's ticked — kept while the app is open. */
const sessions = new Map();

function session(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { scale: 1, tickedIngredients: new Set(), tickedSteps: new Set() });
  }
  return sessions.get(id);
}

export function renderRecipe(id, { onBack, rerender }) {
  const recipe = recipeById(id);

  if (!recipe) {
    fetchRecipe(id).then(rerender).catch(() => {
      toast("That recipe isn't here any more.", { bad: true });
      onBack();
    });
    return { body: spinner('Fetching that recipe…') };
  }

  // The list view carries a summary; notes and the cook log arrive on demand.
  if (!recipe.notes) {
    fetchRecipe(id).then(rerender).catch(() => {});
  }

  const view = session(id);
  const { scale } = view;

  return {
    body: el('div',
      hero(recipe),
      head(recipe),
      facts(recipe, scale),
      scaleRow(recipe, view, rerender),
      ingredients(recipe, view, rerender),
      steps(recipe, view, rerender),
      cookButtons(recipe, rerender),
      ratings(recipe, rerender),
      notes(recipe, rerender),
      cookLog(recipe, rerender),
      dangerZone(recipe, onBack, rerender)),
    appbarActions: [
      iconButton('pencil', 'Edit this recipe', () => openEditor({ recipe, onSaved: rerender })),
    ],
  };
}

/* ----------------------------------------------------------------- head --- */

function hero(recipe) {
  if (recipe.image) {
    return el('div.hero', el('img', { src: recipe.image, alt: recipe.title, decoding: 'async' }));
  }
  return el('div.hero', el('div.hero-empty', { text: emojiFor(recipe.category) }));
}

function head(recipe) {
  const source = sourceLine(recipe);
  return el('div.detail-head',
    el('h2', { text: recipe.title }),
    el('div.row', { style: { marginTop: '10px', flexWrap: 'wrap' } },
      categoryTag(recipe.category),
      recipe.cuisine ? el('span.tag-cat', { text: recipe.cuisine }) : null,
      ...(recipe.tags || []).map((tag) => el('span.tag-cat', { text: tag }))),
    recipe.description ? el('p.muted', { text: recipe.description, style: { margin: '12px 0 0', fontSize: '14.5px', lineHeight: '1.55' } }) : null,
    source ? el('div.source', source) : null);
}

function sourceLine(recipe) {
  const bits = [];
  if (recipe.sourceUrl) {
    bits.push('From ', el('a', {
      href: recipe.sourceUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: recipe.sourceName || new URL(recipe.sourceUrl).hostname.replace(/^www\./, ''),
    }));
  } else if (recipe.sourceName) {
    bits.push(`From ${recipe.sourceName}`);
  }

  if (recipe.addedBy) {
    bits.push(bits.length ? ' · ' : '', `added by ${recipe.addedBy}`);
  }
  return bits.length ? bits : null;
}

function facts(recipe, scale) {
  const items = [];
  if (recipe.prepMin) items.push(['Prep', formatMinutes(recipe.prepMin)]);
  if (recipe.cookMin) items.push(['Cook', formatMinutes(recipe.cookMin)]);
  if (recipe.servings) items.push(['Makes', formatYield(recipe, scale)]);
  if (!items.length) return null;

  return el('div.facts', items.map(([label, value]) => el('div.fact',
    el('div.n', { text: value }),
    el('div.l', { text: label }))));
}

/* ---------------------------------------------------------------- scale --- */

const STEPS = [0.5, 1, 1.5, 2, 3, 4];

function scaleRow(recipe, view, rerender) {
  if (!recipe.ingredients.length) return null;

  const move = (direction) => {
    const index = STEPS.indexOf(view.scale);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, (index === -1 ? 1 : index) + direction))];
    view.scale = next;
    rerender();
  };

  return el('div.row-between', { style: { margin: '18px 2px 0' } },
    el('span.section-title', { text: 'Ingredients', style: { margin: '0' } }),
    el('div.scaler',
      el('button', { type: 'button', 'aria-label': 'Less', onclick: () => move(-1) }, svg(ICONS.minus, { size: 15 })),
      el('span.value', { text: view.scale === 1 ? 'As written' : `${formatQty(view.scale)}×` }),
      el('button', { type: 'button', 'aria-label': 'More', onclick: () => move(1) }, svg(ICONS.plus, { size: 15 }))));
}

/* ---------------------------------------------------------- ingredients --- */

function ingredients(recipe, view, rerender) {
  if (!recipe.ingredients.length) {
    return el('p.muted.tiny', { style: { padding: '16px 2px' }, text: 'No ingredients listed — tap the pencil to add them.' });
  }

  const pantryNorms = state.pantry.map((p) => p.norm).filter(Boolean);
  const list = el('ul.ing-list');
  let lastGroup = null;

  recipe.ingredients.forEach((ing, index) => {
    if (ing.group && ing.group !== lastGroup) {
      list.append(el('li.ing-group', { text: ing.group, style: { display: 'block', borderBottom: 'none' } }));
      lastGroup = ing.group;
    }

    const ticked = view.tickedIngredients.has(index);
    const inPantry = covered(ing.item, pantryNorms);
    const amount = formatAmount(ing, view.scale);

    list.append(el(`li${ticked ? '.ticked' : ''}${inPantry ? '.have-it' : ''}`, {
      onclick: () => {
        if (ticked) view.tickedIngredients.delete(index);
        else view.tickedIngredients.add(index);
        rerender();
      },
      title: inPantry ? "You've got this in" : undefined,
    },
      el('span.qty', { text: amount || '—' }),
      el('span.grow',
        el('span.item', { text: ing.item }),
        ing.note ? el('span.note', { text: `, ${ing.note}` }) : null)));
  });

  return list;
}

/* ---------------------------------------------------------------- steps --- */

function steps(recipe, view, rerender) {
  if (!recipe.steps.length) {
    return el('div',
      el('div.section-title', { text: 'Method' }),
      el('p.muted.tiny', { style: { padding: '0 2px' }, text: recipe.sourceNote || 'No steps came through — tap the pencil to write them in.' }));
  }

  const list = el('ol.steps');
  let lastGroup = null;

  recipe.steps.forEach((step, index) => {
    if (step.group && step.group !== lastGroup) {
      list.append(el('li.ing-group', { text: step.group, style: { display: 'block', borderBottom: 'none' } }));
      lastGroup = step.group;
    }

    const ticked = view.tickedSteps.has(index);
    list.append(el(`li${ticked ? '.ticked' : ''}`, {
      onclick: () => {
        if (ticked) view.tickedSteps.delete(index);
        else view.tickedSteps.add(index);
        rerender();
      },
    },
      el('span.n', { text: String(index + 1) }),
      el('span.grow', { text: step.text })));
  });

  return el('div',
    el('div.row-between', { style: { margin: '26px 2px 6px' } },
      el('span.section-title', { text: 'Method', style: { margin: 0 } }),
      el('button.tiny', {
        type: 'button',
        style: { color: 'var(--accent)', fontWeight: '700' },
        onclick: () => openCookMode(recipe, session(recipe.id).scale),
      }, 'Cook mode →')),
    recipe.sourceNote ? el('p.tiny.muted', { style: { margin: '0 2px 8px' }, text: recipe.sourceNote }) : null,
    list);
}

/* ----------------------------------------------------------- cook / rate --- */

function cookButtons(recipe, rerender) {
  return el('div.row', { style: { marginTop: '22px', gap: '10px' } },
    el('button.btn.btn-primary.grow', {
      type: 'button',
      onclick: () => openCookSheet(recipe, rerender),
    }, svg(ICONS.flame, { size: 18 }), 'We made this'),
    el('button.btn', {
      type: 'button',
      'aria-label': 'Cook mode',
      onclick: () => openCookMode(recipe, session(recipe.id).scale),
    }, svg(ICONS.book, { size: 18 })));
}

export function openCookSheet(recipe, onDone) {
  const dateInput = el('input.input', { type: 'date', value: todayKey(), max: todayKey() });
  const noteInput = textarea({ placeholder: 'How did it go? (optional)', rows: 3 });
  const button = el('button.btn.btn-primary', { type: 'button', text: 'Log it' });

  const sheet = openSheet({
    title: `Made ${recipe.title}`,
    body: el('div',
      field('When', dateInput),
      field('Notes', noteInput)),
    footer: button,
  });

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await logCook(recipe.id, { date: dateInput.value || todayKey(), note: noteInput.value.trim() });
      sheet.close();
      toast('Logged. Nice one.');
      onDone?.();
    } catch (err) {
      toast(err.message, { bad: true });
      button.disabled = false;
      button.textContent = 'Log it';
    }
  };
}

function ratings(recipe, rerender) {
  const people = new Set([state.person, ...Object.keys(recipe.ratings || {})].filter(Boolean));

  return el('div',
    el('div.section-title', { text: 'What you thought' }),
    el('div.card', [...people].map((person) => el('div.rating-row',
      el('span.who', { text: person === state.person ? `${person} (you)` : person }),
      person === state.person
        ? stars(recipe.ratings?.[person] || 0, {
          size: 'big',
          onPick: async (value) => {
            try {
              await rate(recipe.id, value);
              rerender();
            } catch (err) {
              toast(err.message, { bad: true });
            }
          },
        })
        : stars(recipe.ratings?.[person] || 0, { size: 'big' })))));
}

/* ---------------------------------------------------------------- notes --- */

function notes(recipe, rerender) {
  const list = recipe.notes || [];

  return el('div',
    el('div.row-between', { style: { margin: '26px 2px 10px' } },
      el('span.section-title', { text: 'Notes', style: { margin: 0 } }),
      el('button.tiny', {
        type: 'button',
        style: { color: 'var(--accent)', fontWeight: '700' },
        onclick: () => openNoteSheet(recipe, rerender),
      }, '+ Add')),
    list.length
      ? el('div.stack', list.map((note) => el('div.note-item',
        el('div.row-between',
          el('span.who', { text: `${note.person} · ${formatDate(note.createdAt.slice(0, 10))}` }),
          note.person === state.person
            ? el('button', {
              type: 'button',
              'aria-label': 'Delete note',
              style: { color: 'var(--text-3)' },
              onclick: async () => {
                if (!await confirmSheet({
                  title: 'Delete this note?',
                  message: 'It goes for both of you.',
                  confirmLabel: 'Delete',
                  danger: true,
                })) return;
                await removeNote(note.id);
                await fetchRecipe(recipe.id);
                rerender();
              },
            }, svg(ICONS.trash, { size: 14 }))
            : null),
        el('p', { text: note.body }))))
      : el('p.tiny.muted', { style: { padding: '0 2px' }, text: 'Nothing yet. "Needed 10 more minutes", "double the garlic" — that kind of thing.' }));
}

function openNoteSheet(recipe, rerender) {
  const input = textarea({ placeholder: 'What should you remember next time?', rows: 4 });
  const button = el('button.btn.btn-primary', { type: 'button', text: 'Save note' });

  const sheet = openSheet({
    title: 'Add a note',
    body: input,
    footer: button,
  });
  setTimeout(() => input.focus(), 180);

  button.onclick = async () => {
    const body = input.value.trim();
    if (!body) return;
    button.disabled = true;
    try {
      await addNote(recipe.id, body);
      sheet.close();
      rerender();
    } catch (err) {
      toast(err.message, { bad: true });
      button.disabled = false;
    }
  };
}

/* ------------------------------------------------------------- cook log --- */

function cookLog(recipe, rerender) {
  const cooks = recipe.cooks || [];
  if (!cooks.length) return null;

  return el('div',
    el('div.section-title', { text: `Made ${pluralise(cooks.length, 'time')}` }),
    el('div.cook-log', cooks.map((cook) => el('div.entry',
      el('div.grow',
        el('div.when', { text: `${formatDate(cook.date, { weekday: true })} · ${relativeDate(cook.date)}` }),
        el('div.by', { text: cook.note ? `${cook.by} — ${cook.note}` : `by ${cook.by}` })),
      el('button', {
        type: 'button',
        'aria-label': 'Remove this cook',
        style: { color: 'var(--text-3)' },
        onclick: async () => {
          if (!await confirmSheet({
            title: 'Remove this one?',
            message: `The ${formatDate(cook.date)} entry comes off the calendar.`,
            confirmLabel: 'Remove',
            danger: true,
          })) return;
          await removeCook(cook.id);
          await fetchRecipe(recipe.id);
          rerender();
        },
      }, svg(ICONS.x, { size: 16 }))))));
}

function dangerZone(recipe, onBack) {
  return el('div', { style: { marginTop: '34px', textAlign: 'center' } },
    el('button.btn.btn-ghost.tiny', {
      type: 'button',
      style: { color: 'var(--text-3)' },
      onclick: async () => {
        if (!await confirmSheet({
          title: `Delete ${recipe.title}?`,
          message: 'It disappears for both of you. The calendar keeps the record of when you made it.',
          confirmLabel: 'Delete recipe',
          danger: true,
        })) return;
        try {
          await removeRecipe(recipe.id);
          sessions.delete(recipe.id);
          toast('Deleted.');
          onBack();
        } catch (err) {
          toast(err.message, { bad: true });
        }
      },
    }, 'Delete this recipe'));
}
