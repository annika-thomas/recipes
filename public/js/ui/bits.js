/** Small pieces used on more than one screen. */

import { el, svg } from '../util/dom.js';
import { ICONS, emojiFor } from './icons.js';
import { formatMinutes, relativeDate, pluralise } from '../util/format.js';
import { state, averageStars } from '../store.js';

/** A row of stars. Interactive when `onPick` is given. */
export function stars(value, { size = 'small', onPick = null } = {}) {
  const wrap = el(`span.stars${size === 'big' ? '.big' : ''}`);

  for (let i = 1; i <= 5; i += 1) {
    const filled = value >= i - 0.25;
    const star = svg(ICONS.star, { fill: filled });
    if (!filled) star.classList.add('off');

    if (onPick) {
      // Tapping the star you're already on clears the rating — otherwise
      // there's no way back from an accidental one-star.
      wrap.append(el('button', {
        type: 'button',
        'aria-label': `${i} star${i > 1 ? 's' : ''}`,
        onclick: () => onPick(value === i ? 0 : i),
      }, star));
    } else {
      wrap.append(star);
    }
  }
  return wrap;
}

export function categoryLabel(id) {
  return state.categories.find((c) => c.id === id)?.label || 'Mains';
}

export function categoryTag(category) {
  return el('span.tag-cat', { 'data-cat': category, text: categoryLabel(category) });
}

/** A recipe's thumbnail, or a category emoji when there's no photo. */
export function thumb(recipe, className = 'recipe-thumb') {
  if (recipe.image) {
    return el('img', {
      class: className,
      src: recipe.image,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
  }
  return el(`div.${className}.recipe-thumb-fallback`, { text: emojiFor(recipe.category) });
}

/** The line under a recipe title: time · rating · when you last made it. */
function recipeMeta(recipe) {
  const bits = [];
  const total = (recipe.prepMin || 0) + (recipe.cookMin || 0);
  if (total) bits.push(el('span', { text: formatMinutes(total) }));

  const avg = averageStars(recipe);
  if (avg !== null) bits.push(stars(avg));

  if (recipe.timesCooked) {
    bits.push(el('span', {
      text: recipe.timesCooked === 1
        ? `made ${relativeDate(recipe.lastCooked)}`
        : `${pluralise(recipe.timesCooked, 'time')}, last ${relativeDate(recipe.lastCooked)}`,
    }));
  }

  // Each separator is wrapped with the bit it introduces, so a dot never ends
  // up stranded at the end of a line when the row wraps.
  const row = el('div.meta', categoryTag(recipe.category));
  for (const bit of bits) {
    row.append(el('span.meta-bit', el('span.dot', { text: '·' }), bit));
  }
  return row;
}

export function recipeCard(recipe, onOpen) {
  return el('button.recipe-card', { type: 'button', onclick: () => onOpen(recipe.id) },
    thumb(recipe),
    el('div.body',
      el('h3', { text: recipe.title }),
      recipeMeta(recipe)));
}

export function emptyState({ emoji, title, body, action = null }) {
  return el('div.empty',
    el('div.big', { text: emoji }),
    el('h3', { text: title }),
    el('p', { text: body }),
    action ? el('div', { style: { marginTop: '18px' } }, action) : null);
}

export function spinner(message) {
  return el('div.thinking',
    el('div.pot'),
    el('p', { text: message }));
}

export function banner(message, kind = 'info') {
  return el(`div.banner.banner-${kind}`, { text: message });
}

export function iconButton(icon, label, onclick, { className = 'icon-btn' } = {}) {
  return el(`button.${className}`, {
    type: 'button', 'aria-label': label, title: label, onclick,
  }, svg(ICONS[icon] || ICONS.x, { size: 19 }));
}

/** Label + control, the shape every form field in the app uses. */
export function field(label, control) {
  return el('label.field', el('span', { text: label }), control);
}

export function input(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

export function textarea(props = {}) {
  return el('textarea.textarea', props);
}

export function select(options, { value, ...props } = {}) {
  const node = el('select.select', props);
  for (const option of options) {
    node.append(el('option', { value: option.id ?? option.value, text: option.label }));
  }
  if (value !== undefined) node.value = value;
  return node;
}
