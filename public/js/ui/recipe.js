/**
 * One recipe, open.
 *
 * Laid out like a newspaper's recipe page, and built for the moment you're
 * standing at the counter: yield and scale over the ingredients, boxes to
 * tick them off, numbered steps you can tick off too, then "mark as cooked"
 * and a rating right where the method ends. Notes and the cook log live
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
import { stars, categoryTag, spinner, iconButton, field, textarea, photoPicker, thumb } from './bits.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { openEditor } from './editor.js';
import { openCookMode } from './cookmode.js';
import { covered } from '../util/match.js';
import { photoUrl } from '../backends/photos.js';

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
      facts(recipe),
      ingredientsHead(recipe, view, rerender),
      ingredients(recipe, view, rerender),
      steps(recipe, view, rerender),
      cookedRow(recipe, rerender),
      notes(recipe, rerender),
      cookLog(recipe, rerender),
      dangerZone(recipe, onBack, rerender)),
    // Shown in the top bar once the big title has scrolled away.
    title: recipe.title,
    appbarActions: [
      iconButton('pencil', 'Edit this recipe', () => openEditor({ recipe, onSaved: rerender })),
    ],
  };
}

/* ----------------------------------------------------------------- head --- */

function hero(recipe) {
  if (!recipe.photoId && !recipe.image) {
    return el('div.hero', el('div.hero-empty', { text: emojiFor(recipe.category) }));
  }
  const img = el('img', { alt: recipe.title, decoding: 'async' });
  if (recipe.image) img.src = recipe.image;
  else photoUrl(recipe.photoId).then((url) => { if (url) img.src = url; }).catch(() => {});
  return el('div.hero', img);
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

/** Prep, cook and total — how much it makes sits over the ingredients instead. */
function facts(recipe) {
  const items = [];
  if (recipe.prepMin) items.push(['Prep', formatMinutes(recipe.prepMin)]);
  if (recipe.cookMin) items.push(['Cook', formatMinutes(recipe.cookMin)]);
  if (recipe.prepMin && recipe.cookMin) items.push(['Total', formatMinutes(recipe.prepMin + recipe.cookMin)]);
  if (!items.length) return null;

  return el('div.facts', items.map(([label, value]) => el('div.fact',
    el('div.n', { text: value }),
    el('div.l', { text: label }))));
}

/* ---------------------------------------------------------------- scale --- */

const STEPS = [0.5, 1, 1.5, 2, 3, 4];

/** A heading under a heavy rule, the way each part of a printed recipe starts. */
function ruledHead(title, action = null) {
  return el('div.ruled-head',
    el('h2.section-title', { text: title }),
    action);
}

/** INGREDIENTS, then what it makes on the left and how much of it on the right. */
function ingredientsHead(recipe, view, rerender) {
  const yieldText = formatYield(recipe, view.scale);
  const canScale = recipe.ingredients.length > 0;
  if (!canScale && !yieldText) return null;

  return el('div',
    ruledHead('Ingredients'),
    el('div.yield-row',
      el('div',
        el('div.label', { text: 'Yield' }),
        el('div.value', { text: yieldText || '—' })),
      canScale ? el('div', { style: { textAlign: 'right' } },
        el('div.label', { text: 'Scale' }),
        el('button.value', {
          type: 'button',
          'aria-label': 'Change the scale',
          onclick: () => openScaleSheet(view, rerender),
        }, `${formatQty(view.scale)}x`, svg(ICONS.down, { size: 18 }))) : null));
}

function openScaleSheet(view, rerender) {
  const sheet = openSheet({
    title: 'Scale the recipe',
    body: el('div', STEPS.map((step) => el('button.option', {
      type: 'button',
      onclick: () => { view.scale = step; sheet.close(); rerender(); },
    },
      el('div.grow', el('h4', { text: step === 1 ? '1x — as written' : `${formatQty(step)}x` })),
      view.scale === step ? svg(ICONS.check, { size: 18 }) : null))),
  });
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
      role: 'checkbox',
      'aria-checked': String(ticked),
      onclick: () => {
        if (ticked) view.tickedIngredients.delete(index);
        else view.tickedIngredients.add(index);
        rerender();
      },
      title: inPantry ? "You've got this in" : undefined,
    },
      el('span.box', ticked ? svg(ICONS.check, { size: 14, width: 3 }) : null),
      el('span.grow',
        amount ? el('span.qty', { text: `${amount} ` }) : null,
        el('span.item', { text: ing.item }),
        ing.note ? el('span.note', { text: `, ${ing.note}` }) : null)));
  });

  return list;
}

/* ---------------------------------------------------------------- steps --- */

function steps(recipe, view, rerender) {
  if (!recipe.steps.length) {
    return el('div',
      ruledHead('Preparation'),
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
    ruledHead('Preparation'),
    // Overview is this page; Cook Mode is the one-step-at-a-time screen.
    el('div.mode-switch',
      el('button', { type: 'button', 'aria-pressed': 'true', text: 'Overview' }),
      el('button', {
        type: 'button',
        'aria-pressed': 'false',
        text: 'Cook Mode',
        onclick: () => openCookMode(recipe, session(recipe.id).scale),
      })),
    recipe.sourceNote ? el('p.tiny.muted', { style: { margin: '0 2px 8px' }, text: recipe.sourceNote }) : null,
    list);
}

/* ----------------------------------------------------------- cook / rate --- */

/** Where the method ends: say you made it, and say what you thought. */
function cookedRow(recipe, rerender) {
  const made = (recipe.cooks?.length ?? recipe.timesCooked) || 0;
  const others = Object.entries(recipe.ratings || {})
    .filter(([person, value]) => person !== state.person && value);

  return el('div.cooked-row-wrap',
    el('div.cooked-row',
      el('button.mark-cooked', {
        type: 'button',
        'aria-label': made ? `Mark as cooked again — made ${pluralise(made, 'time')}` : 'Mark as cooked',
        onclick: () => openCookSheet(recipe, rerender),
      },
        made ? `Made ${pluralise(made, 'time').replace(/^1 time$/, 'once')}` : 'Mark as cooked',
        el(`span.tick${made ? '.done' : ''}`, svg(ICONS.check, { size: 15, width: 3 }))),
      el('div.rate',
        el('span', { text: 'Rate' }),
        stars(recipe.ratings?.[state.person] || 0, {
          onPick: async (value) => {
            try {
              await rate(recipe.id, value);
              rerender();
            } catch (err) {
              toast(err.message, { bad: true });
            }
          },
        }))),
    others.length
      ? el('div.others-rated', others.map(([person, value]) => el('span', `${person} `, stars(value))))
      : null);
}

export function openCookSheet(recipe, onDone) {
  const dateInput = el('input.input', { type: 'date', value: todayKey(), max: todayKey() });
  const noteInput = textarea({ placeholder: 'How did it go? (optional)', rows: 3 });
  const button = el('button.btn.btn-primary', { type: 'button', text: 'Log it' });

  let photoId = null;

  const sheet = openSheet({
    title: `Made ${recipe.title}`,
    body: el('div',
      field('When', dateInput),
      photoPicker({ onChange: (id) => { photoId = id; }, label: 'Add a photo of it' }),
      field('Notes', noteInput)),
    footer: button,
  });

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await logCook(recipe.id, {
        date: dateInput.value || todayKey(),
        note: noteInput.value.trim(),
        photoId,
      });
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

/* ---------------------------------------------------------------- notes --- */

function notes(recipe, rerender) {
  const list = recipe.notes || [];

  return el('div.notes',
    el('h3.notes-head', svg(ICONS.note, { size: 22 }), 'Your notes'),
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
      : el('p.notes-empty', { text: 'No notes on this recipe yet — "needed 10 more minutes", "double the garlic", that kind of thing.' }),
    el('button.btn.btn-block', {
      type: 'button',
      style: { marginTop: '16px' },
      onclick: () => openNoteSheet(recipe, rerender),
    }, 'Add a note'));
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
    ruledHead(`Made ${pluralise(cooks.length, 'time')}`),
    el('div.cook-log', cooks.map((cook) => el('div.entry',
      cook.photoId ? thumb(cook, 'cook-thumb') : null,
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
