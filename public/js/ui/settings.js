/** Settings — who you are, how it looks, and getting your data out. */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, signOut, refresh } from '../store.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { forgetPerson } from './gate.js';
import { pluralise } from '../util/format.js';

const THEME_KEY = 'kitchen.theme';

export function applyStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.dataset.theme = stored;
    }
  } catch { /* site data blocked — system theme it is */ }
}

function setTheme(value) {
  if (value === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    if (value === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch { /* the choice just won't survive a reload */ }
}

function currentTheme() {
  return document.documentElement.dataset.theme || 'system';
}

export function renderSettings({ onSignedOut, rerender }) {
  const theme = currentTheme();

  return {
    body: el('div',
      el('div.section-title', { text: 'This phone' }),
      el('div.setting-list',
        el('div.setting',
          el('div.grow',
            el('h4', { text: state.person || 'Not signed in' }),
            el('p', { text: 'Your name on ratings, notes and the cook log.' })),
          el('button.btn.btn-ghost.tiny', {
            type: 'button', text: 'Change',
            onclick: async () => {
              if (!await confirmSheet({
                title: 'Sign out of this phone?',
                message: "You'll need the passcode again. The recipes stay where they are.",
                confirmLabel: 'Sign out',
              })) return;
              forgetPerson();
              await signOut();
              onSignedOut();
            },
          })),

        el('div.setting',
          el('div.grow',
            el('h4', { text: 'Appearance' }),
            el('p', { text: 'Dark mode follows your phone unless you say otherwise.' }))),
        el('div', { style: { padding: '0 16px 16px' } },
          el('div.segmented',
            ...['system', 'light', 'dark'].map((value) => el('button', {
              type: 'button',
              'aria-pressed': String(theme === value),
              text: value[0].toUpperCase() + value.slice(1),
              onclick: () => { setTheme(value); rerender(); },
            }))))),

      el('div.section-title', { text: 'The kitchen' }),
      el('div.setting-list',
        el('button.setting', {
          type: 'button',
          onclick: async () => {
            try {
              await refresh();
              toast('Up to date.');
              rerender();
            } catch (err) {
              toast(err.message, { bad: true });
            }
          },
        },
          el('div.grow',
            el('h4', { text: 'Refresh from the server' }),
            el('p', { text: `${pluralise(state.recipes.length, 'recipe')}, ${pluralise(state.cooks.length, 'cook')} logged.` })),
          svg(ICONS.refresh, { size: 18 })),

        el('button.setting', { type: 'button', onclick: exportData },
          el('div.grow',
            el('h4', { text: 'Download a backup' }),
            el('p', { text: 'Every recipe, rating, note and cook as one JSON file.' })),
          svg(ICONS.download, { size: 18 })),

        el('button.setting', { type: 'button', onclick: openAbout },
          el('div.grow',
            el('h4', { text: 'How importing works' }),
            el('p', { text: 'What each kind of link can and cannot give you.' })),
          svg(ICONS.next, { size: 18 }))),

      !state.canImport
        ? el('p.tiny.muted', { style: { margin: '18px 4px', lineHeight: '1.5' } },
          'Importing is currently off: the server has no Anthropic API key. '
          + 'Add one with `npx wrangler secret put ANTHROPIC_API_KEY` and it lights up.')
        : null,

      el('p.tiny.muted', { style: { textAlign: 'center', margin: '30px 0 0' }, text: 'Kitchen' })),
  };
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    recipes: state.recipes,
    cooks: state.cooks,
    pantry: state.pantry,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: `kitchen-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openAbout() {
  openSheet({
    title: 'How importing works',
    body: el('div', { style: { lineHeight: '1.6', fontSize: '14.5px' } },
      para('Recipe websites', 'Nearly every food site publishes its recipes in a machine-readable form so Google can show recipe cards. When one does, you get it exactly — right quantities, right steps — and no model is involved at all. When it does not, the page text is read instead.'),
      para('TikTok, Instagram and YouTube', 'These give us the caption or description, not the video. Nobody is watching or transcribing the footage. When the creator wrote the recipe out — and food creators usually do, so people can save it — this works well. When the recipe only exists in the voiceover or on-screen text, the import says so rather than making it up.'),
      para('Photos', 'Anything readable: a cookbook page, a handwritten card, a screenshot of a post. Multiple photos of one recipe are read together, in order. This is the fallback that always works, including for reels — screenshot the on-screen steps.'),
      para('Every import lands in the editor first', "Nothing saves until you've looked at it. Quantities and temperatures are the things worth checking; a missing one shows as blank rather than a guess.")),
  });
}

function para(title, body) {
  return el('div', { style: { marginBottom: '16px' } },
    el('h4', { text: title, style: { fontSize: '14px', marginBottom: '4px' } }),
    el('p.muted', { text: body, style: { margin: 0, fontSize: '14px' } }));
}
