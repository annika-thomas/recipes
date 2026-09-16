/**
 * The way in.
 *
 * One passcode for the household, then you say which of you this phone is —
 * that name is what ends up next to your ratings and on the cook log, so it's
 * worth asking once rather than guessing.
 */

import { el } from '../util/dom.js';
import { state, signIn } from '../store.js';
import { toast } from './sheet.js';

const REMEMBERED = 'kitchen.person';

export function renderGate(onSignedIn) {
  let person = '';
  try {
    person = localStorage.getItem(REMEMBERED) || '';
  } catch {
    // Private browsing, or site data blocked. Not remembering a name is fine.
  }

  const passcodeInput = el('input.input', {
    type: 'password',
    inputmode: 'text',
    autocomplete: 'current-password',
    placeholder: 'Household passcode',
    'aria-label': 'Household passcode',
  });

  const nameInput = el('input.input', {
    type: 'text',
    autocomplete: 'nickname',
    placeholder: 'Your name',
    'aria-label': 'Your name',
    value: person,
  });

  const button = el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Open the kitchen' });
  const message = el('p.tiny', { style: { color: 'var(--danger)', minHeight: '18px', margin: '10px 0 0' } });

  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        message.textContent = 'Put your name in so ratings can tell you two apart.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Opening…';
      message.textContent = '';

      try {
        await signIn(passcodeInput.value, name);
        try {
          localStorage.setItem(REMEMBERED, name);
        } catch { /* nothing to do, and nothing worth saying */ }
        onSignedIn();
      } catch (err) {
        message.textContent = err.message;
        passcodeInput.select();
      } finally {
        button.disabled = false;
        button.textContent = 'Open the kitchen';
      }
    },
  },
    passcodeInput,
    el('div', { style: { height: '10px' } }),
    nameInput,
    el('div', { style: { height: '16px' } }),
    button,
    message);

  const notConfigured = !state.configured;

  return el('div.gate',
    el('div.mark', { text: '🍲' }),
    el('h1', { text: 'Kitchen' }),
    el('p', {
      text: notConfigured
        ? 'This kitchen has no passcode yet. Set one on the server first — the README has the two commands.'
        : 'The recipes you two keep. Type the passcode you share, and tell it who you are.',
    }),
    notConfigured ? null : form);
}

/** Used by Settings to switch which person this phone is. */
export function forgetPerson() {
  try {
    localStorage.removeItem(REMEMBERED);
  } catch {
    toast("Couldn't clear the saved name on this device.", { bad: true });
  }
}
