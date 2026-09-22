/** Small pieces used on more than one screen. */

import { el, svg } from '../util/dom.js';
import { ICONS, emojiFor } from './icons.js';
import { formatMinutes, relativeDate, pluralise } from '../util/format.js';
import { state, averageStars } from '../store.js';
import { photoUrl, putPhoto, getPhoto } from '../backends/photos.js';
import { openCropper } from './cropper.js';

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
 * Shows the current one, with a way to recrop it and a way to remove it.
 *
 * Every photo goes through the cropper on the way in. A phone camera frames
 * for the room and the app shows the result as a wide strip and a small
 * square, so being asked once which part matters beats the app guessing
 * "the middle" every time it draws it.
 */
export function photoPicker({ photoId = null, onChange, label = 'Add a photo' } = {}) {
  const wrap = el('div', { style: { marginBottom: '14px' } });
  let current = photoId;

  const busyWith = (message) => {
    replaceChildren(wrap);
    wrap.append(el('p.tiny.muted', { text: message }));
  };

  const failed = (message) => {
    render();
    wrap.append(el('p.tiny', { text: message, style: { color: 'var(--danger)' } }));
  };

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

      wrap.append(preview, el('div.photo-actions',
        el('button.btn.btn-ghost', { type: 'button', onclick: pick }, 'Change photo'),
        el('button.btn.btn-ghost', { type: 'button', onclick: recrop },
          svg(ICONS.crop, { size: 16 }), 'Crop'),
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

  /** Pick a file, choose the part of it that matters, then store that. */
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

      // Cancelling the cropper cancels the photo, not just the crop: the
      // previous one is still there, and silently swapping it for a photo
      // whose framing you just backed out of would be a strange reward.
      const crop = await openCropper({ source: file, confirmLabel: 'Use this photo' });
      if (!crop) { render(); return; }

      busyWith('Saving that photo…');
      try {
        current = await putPhoto(file, { crop });
        onChange(current);
        render();
      } catch (err) {
        failed(err.message);
      }
    }, { once: true });

    picker.click();
  }

  /**
   * Recrop the photo that's already stored.
   *
   * It crops what was saved rather than the original file, which is gone by
   * now — so this trims, it doesn't recover anything the first crop cut off.
   * The result is a new photo rather than an overwrite, because the editor
   * hasn't saved yet and backing out of it shouldn't have changed the picture
   * on the recipe.
   */
  async function recrop() {
    const id = current;
    if (!id) return;

    busyWith('Opening that photo…');
    let blob;
    try {
      blob = await getPhoto(id);
    } catch {
      blob = null;
    }
    if (!blob) {
      failed("That photo isn't on this device any more.");
      return;
    }

    render();
    const crop = await openCropper({ source: blob, title: 'Crop this photo' });
    if (!crop) return;

    busyWith('Cropping…');
    try {
      current = await putPhoto(blob, { crop });
      onChange(current);
      render();
    } catch (err) {
      failed(err.message);
    }
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
