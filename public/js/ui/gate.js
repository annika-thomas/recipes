/**
 * The way in.
 *
 * Two shapes, depending on where the recipes live. With a server there's a
 * household passcode to type, because the box is on the internet and shared.
 * On a device-only box there's nothing to protect — the data never leaves this
 * phone — so all that's asked is a name to put on ratings and the cook log.
 */

import { el } from '../util/dom.js';
import { state, signIn, boxSummary } from '../store.js';
import { toast } from './sheet.js';
import { pluralise } from '../util/format.js';

const REMEMBERED = 'kitchen.person';

function rememberedName() {
  try {
    return localStorage.getItem(REMEMBERED) || '';
  } catch {
    // Private browsing, or site data blocked. Not remembering is fine.
    return '';
  }
}

function remember(name) {
  try {
    localStorage.setItem(REMEMBERED, name);
  } catch { /* they'll be asked again next time, which is survivable */ }
}

export function renderGate(onSignedIn) {
  const onDevice = state.mode === 'local';

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
    value: rememberedName(),
    enterkeyhint: 'go',
  });

  const button = el('button.btn.btn-primary.btn-block', {
    type: 'submit',
    text: onDevice ? 'Start cooking' : 'Open the kitchen',
  });
  const message = el('p.tiny', {
    style: { color: 'var(--danger)', minHeight: '18px', margin: '10px 0 0' },
  });

  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        message.textContent = onDevice
          ? 'A name goes on your ratings and notes.'
          : 'Put your name in so ratings can tell you two apart.';
        nameInput.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Opening…';
      message.textContent = '';

      try {
        await signIn(passcodeInput.value, name);
        remember(name);
        onSignedIn();
      } catch (err) {
        message.textContent = err.message;
        if (!onDevice) passcodeInput.select();
      } finally {
        button.disabled = false;
        button.textContent = onDevice ? 'Start cooking' : 'Open the kitchen';
      }
    },
  },
    onDevice ? null : passcodeInput,
    onDevice ? null : el('div', { style: { height: '10px' } }),
    nameInput,
    el('div', { style: { height: '16px' } }),
    button,
    message);

  const notConfigured = !state.configured;

  /*
    Being asked your name looks exactly like being asked it for the first time,
    and if you know you had recipes, that reads as "they're gone". Usually they
    aren't — you signed out, or this device is being handed to the other one of
    you. Counting what's actually still in the box settles it on the spot.
  */
  const held = onDevice ? boxSummary() : null;

  return el('div.gate',
    el('div.mark', { text: '🍲' }),
    el('h1', { text: 'Kitchen' }),
    el('p', { text: blurb(onDevice, notConfigured) }),
    held?.recipes
      ? el('p.tiny', { style: { margin: '-6px 0 18px', fontWeight: '700', color: 'var(--accent)' },
        text: `${pluralise(held.recipes, 'recipe')} still saved on this phone.` })
      : null,
    notConfigured ? null : form,
    onDevice && !notConfigured && !held?.recipes
      ? el('p.tiny.muted', { style: { marginTop: '22px', lineHeight: '1.55' } },
        'Recipes you add are kept on this device. Nothing is uploaded, and nothing is '
        + 'shared with another phone — Settings explains how to move them.')
      : null);
}

function blurb(onDevice, notConfigured) {
  if (notConfigured) {
    return state.local
      ? 'No passcode set yet. Stop the server, run `npm run setup`, and start it again.'
      : 'This kitchen has no passcode yet. Set one on the server first — the README has the commands.';
  }
  return onDevice
    ? 'Your recipe box, on this phone. What should it call you?'
    : 'The recipes you two keep. Type the passcode you share, and tell it who you are.';
}

/** Used by Settings to switch which person this device is. */
export function forgetPerson() {
  try {
    localStorage.removeItem(REMEMBERED);
  } catch {
    toast("Couldn't clear the saved name on this device.", { bad: true });
  }
}
