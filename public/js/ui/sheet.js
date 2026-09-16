/**
 * Bottom sheets and toasts.
 *
 * Everything modal in the app is a sheet: the add menu, the editor, logging a
 * cook. They stack, they close on the scrim and on Back, and they lock the page
 * behind them so iOS doesn't rubber-band the whole app while you scroll a form.
 */

import { el, svg, replace } from '../util/dom.js';
import { ICONS } from './icons.js';

const open = [];

/**
 * Sheets deliberately stay out of the history stack.
 *
 * Pushing an entry per sheet is the obvious way to make the Back gesture close
 * one, but it fights the app's own hash routing: closing a sheet and opening
 * the next in the same tick (which "Add → Type it in" does) leaves a pending
 * `history.back()` racing a fresh `pushState`, and the two interleave into a
 * stack nobody can reason about. Sheets close on the scrim, the button, Escape,
 * and any route change — which covers every way out of one on a phone.
 */

function lockScroll(locked) {
  document.body.style.overflow = locked ? 'hidden' : '';
}

/**
 * openSheet({ title, body, footer, onClose }) -> { close, setBody, setFooter }
 * `body` and `footer` are nodes, or functions given the handle so they can
 * close the sheet they live in.
 */
export function openSheet({ title, body, footer, onClose, dismissible = true } = {}) {
  const scrim = el('div.scrim');
  const bodyWrap = el('div.sheet-body');
  const footerWrap = el('div.sheet-footer');

  const handle = {};
  let closed = false;

  const onKey = (event) => {
    // Escape closes the topmost sheet only.
    if (event.key === 'Escape' && dismissible && open[open.length - 1] === handle) {
      handle.close();
    }
  };

  handle.close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    sheet.remove();
    const index = open.indexOf(handle);
    if (index !== -1) open.splice(index, 1);
    if (!open.length) {
      lockScroll(false);
      document.removeEventListener('keydown', onKey);
    }
    onClose?.();
  };

  const closeBtn = el('button.icon-btn', {
    type: 'button', 'aria-label': 'Close', onclick: () => handle.close(),
  }, svg(ICONS.x, { size: 18 }));

  const sheet = el('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
    el('div.grip'),
    title ? el('header', el('h2', { text: title }), dismissible ? closeBtn : null) : null,
    bodyWrap,
    footerWrap);

  handle.setBody = (...children) => { replace(bodyWrap, children); return handle; };
  handle.setFooter = (...children) => {
    replace(footerWrap, children);
    footerWrap.hidden = !children.flat(3).filter(Boolean).length;
    return handle;
  };

  handle.setBody(typeof body === 'function' ? body(handle) : body);
  handle.setFooter(typeof footer === 'function' ? footer(handle) : footer);

  if (dismissible) scrim.addEventListener('click', () => handle.close());

  document.body.append(scrim, sheet);
  lockScroll(true);
  open.push(handle);
  document.addEventListener('keydown', onKey);

  return handle;
}

/** Called on every route change, so a sheet never outlives the screen under it. */
export function closeAllSheets() {
  while (open.length) open[open.length - 1].close();
}

/** A sheet that asks one yes/no question. Resolves to true/false. */
export function confirmSheet({ title, message, confirmLabel = 'Do it', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = openSheet({
      title,
      body: el('p.muted', { text: message, style: { margin: '2px 0 8px', lineHeight: '1.5' } }),
      footer: [
        el('button.btn.btn-ghost', {
          type: 'button',
          text: 'Cancel',
          onclick: () => { answered = true; resolve(false); sheet.close(); },
        }),
        el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {
          type: 'button',
          text: confirmLabel,
          onclick: () => { answered = true; resolve(true); sheet.close(); },
        }),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------------------------------------------------------------- toast --- */

let toastWrap;

export function toast(message, { bad = false, ms = 2600 } = {}) {
  if (!toastWrap) {
    toastWrap = el('div.toast-wrap');
    document.body.append(toastWrap);
  }
  const node = el(`div.toast${bad ? '.bad' : ''}`, { text: message, role: 'status' });
  toastWrap.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}
