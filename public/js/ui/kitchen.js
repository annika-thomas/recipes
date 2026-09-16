/**
 * What's in the house, and what that means for dinner.
 *
 * Two halves. The top is the inventory — quick to add to, quicker to clear.
 * The bottom answers the actual question, which is never "what do I own" but
 * "what can I make right now". Nothing is hidden from the suggestions: a
 * recipe you're two things short of still shows, with the two things named,
 * because that's a shopping list, not a failure.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import {
  state, addPantry, removePantry, clearPantry, seedStaples, suggestions,
} from '../store.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { emptyState, field, input, select, spinner, banner, thumb } from './bits.js';
import { formatMinutes, relativeDate, pluralise } from '../util/format.js';

const LOCATION_LABELS = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  pantry: 'Cupboard',
  spices: 'Spices',
};

const view = { tab: 'suggest', category: null };

export function renderKitchen({ onOpen, rerender }) {
  const tabs = el('div.segmented', { style: { marginBottom: '16px' } },
    tabButton('suggest', 'What can I make?', rerender),
    tabButton('pantry', `In the house${state.pantry.length ? ` (${state.pantry.length})` : ''}`, rerender));

  return {
    body: el('div', tabs, view.tab === 'pantry'
      ? pantryPane(rerender)
      : suggestPane(onOpen, rerender)),
    appbarActions: [
      el('button.icon-btn', {
        type: 'button', 'aria-label': 'Add to the kitchen',
        onclick: () => openAddItemSheet(rerender),
      }, svg(ICONS.plus, { size: 19 })),
    ],
  };
}

function tabButton(id, label, rerender) {
  return el('button', {
    type: 'button',
    'aria-pressed': String(view.tab === id),
    text: label,
    onclick: () => { view.tab = id; rerender(); },
  });
}

/* --------------------------------------------------------------- pantry --- */

function pantryPane(rerender) {
  if (!state.pantry.length) {
    return emptyState({
      emoji: '🧺',
      title: 'The cupboard is bare',
      body: "Add what you've got and the app can tell you what it adds up to. Start with the staples — salt, oil, flour — and add the perishables as you shop.",
      action: el('button.btn.btn-primary', {
        type: 'button',
        onclick: async () => {
          try {
            await seedStaples();
            toast('Staples added.');
            rerender();
          } catch (err) {
            toast(err.message, { bad: true });
          }
        },
      }, 'Add the usual staples'),
    });
  }

  const groups = new Map();
  for (const item of state.pantry) {
    const key = item.staple ? 'staples' : item.location;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const order = ['fridge', 'freezer', 'pantry', 'spices', 'staples'];
  const panes = order.filter((key) => groups.has(key)).map((key) => el('div.pantry-group',
    el('div.section-title', { text: key === 'staples' ? 'Always in' : LOCATION_LABELS[key] || key }),
    el('div.pantry-items', groups.get(key).map((item) => pantryChip(item, rerender)))));

  return el('div',
    panes,
    el('div.row', { style: { marginTop: '24px', gap: '10px' } },
      el('button.btn.grow', { type: 'button', onclick: () => openAddItemSheet(rerender) },
        svg(ICONS.plus, { size: 16 }), 'Add something'),
      el('button.btn.btn-ghost', {
        type: 'button',
        onclick: async () => {
          if (!await confirmSheet({
            title: 'Clear the perishables?',
            message: 'Everything except the staples comes off the list. Useful right before a shop.',
            confirmLabel: 'Clear',
            danger: true,
          })) return;
          await clearPantry();
          rerender();
        },
      }, 'Clear')));
}

function pantryChip(item, rerender) {
  return el(`span.pantry-chip${item.staple ? '.staple' : ''}`,
    el('span', { text: item.name }),
    item.qty ? el('span.qty', { text: item.qty }) : null,
    el('button.x', {
      type: 'button',
      'aria-label': `Remove ${item.name}`,
      text: '×',
      onclick: async () => {
        try {
          await removePantry(item.id);
          rerender();
        } catch (err) {
          toast(err.message, { bad: true });
        }
      },
    }));
}

function openAddItemSheet(rerender) {
  const nameInput = input({ placeholder: 'Chicken thighs', enterkeyhint: 'done' });
  const qtyInput = input({ placeholder: '500g (optional)' });
  const locationSelect = select(
    Object.entries(LOCATION_LABELS).map(([id, label]) => ({ id, label })),
    { value: 'fridge' },
  );
  const stapleToggle = el('input', { type: 'checkbox', style: { width: '20px', height: '20px' } });
  const added = el('div.pantry-items', { style: { marginTop: '14px' } });

  const save = async (keepOpen) => {
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      await addPantry({
        name,
        qty: qtyInput.value.trim(),
        location: locationSelect.value,
        staple: stapleToggle.checked,
      });
      added.append(el('span.pantry-chip', el('span', { text: name })));
      nameInput.value = '';
      qtyInput.value = '';
      rerender();
      if (keepOpen) nameInput.focus();
    } catch (err) {
      toast(err.message, { bad: true });
    }
  };

  // Enter adds and keeps going — unpacking a shop is a dozen of these in a row.
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); save(true); }
  });

  const sheet = openSheet({
    title: 'Add to the kitchen',
    body: el('div',
      field('What', nameInput),
      el('div.field-row', field('How much', qtyInput), field('Where', locationSelect)),
      el('label.row', { style: { gap: '10px', padding: '4px 2px 0' } },
        stapleToggle,
        el('span.tiny.muted', { text: "Always in stock — don't ask me to tick this off again" })),
      added),
    footer: (handle) => [
      el('button.btn.btn-ghost', { type: 'button', text: 'Done', onclick: () => handle.close() }),
      el('button.btn.btn-primary', { type: 'button', text: 'Add', onclick: () => save(true) }),
    ],
  });

  setTimeout(() => nameInput.focus(), 200);
  return sheet;
}

/* ----------------------------------------------------------- suggestions --- */

function suggestPane(onOpen, rerender) {
  if (!state.recipes.length) {
    return emptyState({
      emoji: '🍽️',
      title: 'Add some recipes first',
      body: 'Once there are recipes in the box, this works out which ones you can make with what you have.',
    });
  }

  const pane = el('div');

  const chips = el('div.chips',
    el('button.chip', {
      type: 'button',
      'aria-pressed': String(view.category === null),
      text: 'Anything',
      onclick: () => { view.category = null; rerender(); },
    }),
    state.categories.map((category) => el('button.chip', {
      type: 'button',
      'aria-pressed': String(view.category === category.id),
      text: category.label,
      onclick: () => {
        view.category = view.category === category.id ? null : category.id;
        rerender();
      },
    })));

  const results = el('div', spinner('Working out what you can make…'));
  pane.append(chips, results);

  suggestions(view.category)
    .then(({ suggestions: list, pantrySize }) => {
      results.replaceChildren(renderSuggestions(list, pantrySize, onOpen, rerender));
    })
    .catch((err) => {
      results.replaceChildren(banner(err.message, 'error'));
    });

  return pane;
}

function renderSuggestions(list, pantrySize, onOpen, rerender) {
  if (!list.length) {
    return emptyState({
      emoji: '🤷',
      title: 'Nothing to go on',
      body: "None of your recipes here have an ingredient list, so there's nothing to match against.",
    });
  }

  const wrap = el('div');

  if (!pantrySize) {
    wrap.append(el('div', { style: { marginBottom: '14px' } },
      banner("Nothing's in the kitchen list yet, so this is just your library. Add a few things and it starts being useful.", 'info'),
      el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: () => { view.tab = 'pantry'; rerender(); },
      }, 'Fill in the kitchen')));
  }

  const ready = list.filter((s) => s.missing.length === 0);
  const close = list.filter((s) => s.missing.length > 0 && s.missing.length <= 3);
  const rest = list.filter((s) => s.missing.length > 3);

  if (ready.length) {
    wrap.append(el('div.section-title', { text: `You can make ${pluralise(ready.length, 'thing')} right now` }));
    wrap.append(el('div.recipe-list', ready.map((s) => suggestionCard(s, onOpen))));
  }
  if (close.length) {
    wrap.append(el('div.section-title', { text: 'A shop away' }));
    wrap.append(el('div.recipe-list', close.map((s) => suggestionCard(s, onOpen))));
  }
  if (rest.length && !ready.length && !close.length) {
    wrap.append(el('div.section-title', { text: 'Closest matches' }));
    wrap.append(el('div.recipe-list', rest.slice(0, 10).map((s) => suggestionCard(s, onOpen))));
  }

  return wrap;
}

function suggestionCard({ recipe, coverage, missing, have, total }, onOpen) {
  const band = coverage === 1 ? 'full' : coverage >= 0.7 ? 'near' : 'far';
  const time = formatMinutes((recipe.prepMin || 0) + (recipe.cookMin || 0));

  return el('button.recipe-card', { type: 'button', onclick: () => onOpen(recipe.id) },
    thumb(recipe),
    el('div.body',
      el('h3', { text: recipe.title }),
      el('div.meta',
        el(`span.coverage.${band}`,
          el('span.bar', el('span', { style: { width: `${Math.round(coverage * 100)}%` } })),
          el('span', { text: `${have}/${total}` })),
        time ? el('span.meta-bit', el('span.dot', { text: '·' }), el('span', { text: time })) : null,
        recipe.lastCooked
          ? el('span.meta-bit', el('span.dot', { text: '·' }),
            el('span', { text: `made ${relativeDate(recipe.lastCooked)}` }))
          : null),
      missing.length
        ? el('div.missing-line', { text: `Need: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? `, +${missing.length - 4}` : ''}` })
        : null));
}
