/** Small pieces used on more than one screen. */

import { el, svg } from '../util/dom.js';
import { ICONS, emojiFor } from './icons.js';
import { formatMinutes, relativeDate, pluralise } from '../util/format.js';
import { state, averageStars } from '../store.js';
import { photoUrl, putPhoto } from '../backends/photos.js';

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

/**
 * A picture of the food, or a category emoji when there isn't one.
 *
 * The blob lives in IndexedDB, so the URL arrives a tick later than the render.
 * The emoji goes up first and is replaced when the photo resolves, which keeps
 * lists from reflowing and means a missing photo degrades to something
 * sensible rather than a broken image.
 */
export function thumb(record, className = 'recipe-thumb') {
  const node = el(`div.${className}.recipe-thumb-fallback`, {
    text: emojiFor(record.category),
  });

  const id = record.photoId;
  const direct = record.image;   // a server-hosted photo, when there's a server

  if (!id && !direct) return node;

  const apply = (url) => {
    if (!url || !node.isConnected) return;
    node.classList.remove('recipe-thumb-fallback');
    node.textContent = '';
    node.style.backgroundImage = `url("${url}")`;
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center';
  };

  if (direct) apply(direct);
  else photoUrl(id).then(apply).catch(() => {});

  return node;
}

/**
 * A button that picks a photo, stores it, and hands back its id.
 * Shows the current one, with a way to remove it.
 */
export function photoPicker({ photoId = null, onChange, label = 'Add a photo' } = {}) {
  const wrap = el('div', { style: { marginBottom: '14px' } });
  let current = photoId;

  const render = () => {
    replaceChildren(wrap);

    if (current) {
      const preview = el('div', {
        style: {
          width: '100%', height: '160px', borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--surface-2)', backgroundSize: 'cover',
          backgroundPosition: 'center', marginBottom: '8px',
        },
      });
      photoUrl(current).then((url) => {
        if (url) preview.style.backgroundImage = `url("${url}")`;
      }).catch(() => {});

      wrap.append(preview, el('div.row', { style: { gap: '8px' } },
        el('button.btn.btn-ghost.grow', { type: 'button', onclick: pick }, 'Change photo'),
        el('button.btn.btn-ghost', {
          type: 'button',
          style: { color: 'var(--danger)' },
          onclick: () => { current = null; onChange(null); render(); },
        }, 'Remove')));
      return;
    }

    wrap.append(el('button.btn.btn-ghost.btn-block', { type: 'button', onclick: pick },
      svg(ICONS.camera, { size: 18 }), label));
  };

  function pick() {
    const picker = el('input', {
      type: 'file',
      accept: 'image/*',
      // On iOS this offers the camera as well as the library.
      hidden: true,
    });
    document.body.append(picker);

    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.remove();
      if (!file) return;

      const busy = el('p.tiny.muted', { text: 'Saving that photo…' });
      replaceChildren(wrap);
      wrap.append(busy);

      try {
        current = await putPhoto(file);
        onChange(current);
      } catch (err) {
        wrap.append(el('p.tiny', { text: err.message, style: { color: 'var(--danger)' } }));
      }
      render();
    }, { once: true });

    picker.click();
  }

  render();
  return wrap;
}

function replaceChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
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
