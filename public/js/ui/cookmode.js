/**
 * Cook mode — one step at a time, in type you can read from across the counter.
 *
 * Three things matter when your hands are covered in flour: the text is big,
 * the screen doesn't sleep, and the ingredients for *this* step are right
 * there so you don't have to scroll back up.
 */

import { el, svg, replace } from '../util/dom.js';
import { ICONS } from './icons.js';
import { formatAmount } from '../util/format.js';
import { openCookSheet } from './recipe.js';
import { toast } from './sheet.js';

export function openCookMode(recipe, scale = 1) {
  if (!recipe.steps?.length) {
    toast('This one has no steps written down yet.', { bad: true });
    return;
  }

  let index = 0;
  let wakeLock = null;

  const body = el('div.body');
  const bar = el('span');
  const title = el('h3', { text: recipe.title });
  const footer = el('footer');

  const root = el('div.cookmode', { role: 'dialog', 'aria-modal': 'true' },
    el('header',
      el('button.icon-btn', { type: 'button', 'aria-label': 'Leave cook mode', onclick: () => close() },
        svg(ICONS.x, { size: 18 })),
      title),
    el('div.progress', bar),
    body,
    footer);

  /* Keep the screen awake. Not supported everywhere (Safari got it in 16.4),
     and it can be refused — so it's best-effort and never blocks anything. */
  async function acquireLock() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  function releaseLock() {
    try {
      wakeLock?.release();
    } catch { /* already gone */ }
    wakeLock = null;
  }

  // iOS drops the lock whenever the app goes to the background.
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && root.isConnected) acquireLock();
  };

  function close() {
    releaseLock();
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    root.remove();
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0) return;
    if (next >= recipe.steps.length) return;
    index = next;
    draw();
    body.scrollTop = 0;
  }

  function draw() {
    const step = recipe.steps[index];
    const last = index === recipe.steps.length - 1;

    bar.style.width = `${((index + 1) / recipe.steps.length) * 100}%`;

    replace(body,
      el('div.stepno', { text: step.group ? `${step.group} · Step ${index + 1} of ${recipe.steps.length}` : `Step ${index + 1} of ${recipe.steps.length}` }),
      el('div.steptext', { text: step.text }),
      stepIngredients(recipe, step, scale));

    replace(footer,
      el('button.btn', {
        type: 'button',
        disabled: index === 0,
        onclick: () => go(-1),
      }, svg(ICONS.back, { size: 18 }), 'Back'),
      last
        ? el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => { close(); openCookSheet(recipe); },
        }, svg(ICONS.check, { size: 18 }), 'Done — log it')
        : el('button.btn.btn-primary', { type: 'button', onclick: () => go(1) },
          'Next', svg(ICONS.next, { size: 18 })));
  }

  /* Swipe between steps — the gesture people already expect here. */
  let startX = 0;
  let startY = 0;
  root.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });

  root.addEventListener('touchend', (event) => {
    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;
    // Horizontal, and clearly not a scroll.
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  draw();
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  acquireLock();
}

/**
 * Which ingredients does this step mention?
 *
 * A plain word match against the step text. It misses the ones a recipe refers
 * to obliquely ("add the remaining dry ingredients"), which is why the section
 * is titled "in this step" and not "everything you need" — it's a convenience,
 * and the full list is one tap away.
 */
function stepIngredients(recipe, step, scale) {
  const text = step.text.toLowerCase();

  const used = (recipe.ingredients || []).filter((ing) => {
    const words = ing.item.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((word) => text.includes(word.replace(/e?s$/, '')));
  });

  if (!used.length) return null;

  return el('div.step-ings',
    el('div.stepno', { text: 'In this step' }),
    el('ul.ing-list', { style: { marginTop: '6px' } },
      used.map((ing) => el('li',
        el('span.qty', { text: formatAmount(ing, scale) || '—' }),
        el('span.grow', { text: ing.item })))));
}
