/** Settings — who you are, how it looks, and getting your data in and out. */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, signOut, refresh, exportData, importData } from '../store.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { forgetPerson } from './gate.js';
import { pluralise } from '../util/format.js';
import { banner } from './bits.js';

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
  const onDevice = state.mode === 'local';

  return {
    body: el('div',
      onDevice ? deviceNotice() : null,

      el('div.section-title', { text: 'This device' }),
      el('div.setting-list',
        el('div.setting',
          el('div.grow',
            el('h4', { text: state.person || 'Not signed in' }),
            el('p', { text: 'Your name on ratings, notes and the cook log.' })),
          el('button.btn.btn-ghost.tiny', {
            type: 'button',
            text: 'Change',
            onclick: async () => {
              if (!await confirmSheet({
                title: onDevice ? 'Change the name on this device?' : 'Sign out of this phone?',
                message: onDevice
                  ? "Your recipes stay exactly where they are — this only changes whose name goes on new ratings and notes."
                  : "You'll need the passcode again. The recipes stay where they are.",
                confirmLabel: onDevice ? 'Change name' : 'Sign out',
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

      el('div.section-title', { text: 'Your recipes' }),
      el('div.setting-list',
        onDevice ? null : el('button.setting', {
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
            el('p', { text: countsLine() })),
          svg(ICONS.refresh, { size: 18 })),

        el('button.setting', { type: 'button', onclick: () => exportBackup(onDevice) },
          el('div.grow',
            el('h4', { text: 'Download a backup' }),
            el('p', { text: onDevice ? countsLine() : 'Every recipe, rating, note and cook as one file.' })),
          svg(ICONS.download, { size: 18 })),

        onDevice ? el('button.setting', { type: 'button', onclick: () => openRestore(rerender) },
          el('div.grow',
            el('h4', { text: 'Open a backup' }),
            el('p', { text: 'Add recipes from a backup file — how you move them to another device.' })),
          svg(ICONS.share, { size: 18 })) : null,

        el('button.setting', { type: 'button', onclick: () => openAbout(onDevice) },
          el('div.grow',
            el('h4', { text: onDevice ? 'Adding recipes, and sharing them' : 'How importing works' }),
            el('p', { text: onDevice ? 'What this copy can do, and what needs a server.' : 'What each kind of link can and cannot give you.' })),
          svg(ICONS.next, { size: 18 }))),

      !onDevice && !state.canImport
        ? el('p.tiny.muted', { style: { margin: '18px 4px', lineHeight: '1.5' } },
          'Importing is currently off: the server has no Anthropic API key. '
          + 'Add one with `npx wrangler secret put ANTHROPIC_API_KEY` and it lights up.')
        : null,

      el('p.tiny.muted', { style: { textAlign: 'center', margin: '30px 0 0' }, text: 'Kitchen' })),
  };
}

function countsLine() {
  return `${pluralise(state.recipes.length, 'recipe')}, ${pluralise(state.cooks.length, 'cook')} logged.`;
}

function deviceNotice() {
  return el('div', { style: { marginBottom: '4px' } },
    banner(
      'This copy keeps everything on this device. Nothing is uploaded, which also means '
      + 'another phone gets its own separate box — use a backup file to move recipes across.',
      'info',
    ));
}

/* --------------------------------------------------------------- backup --- */

function exportBackup(onDevice) {
  const payload = exportData();
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

  if (onDevice) {
    toast('Saved. Send it to your other device and use "Open a backup" there.');
  }
}

/**
 * Restoring merges rather than replaces, so opening a backup on a device that
 * already has recipes doesn't throw either side away. It's also the closest
 * thing to sharing this mode has: export on one phone, open on the other.
 */
function openRestore(rerender) {
  const picker = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  document.body.append(picker);

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.remove();
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const { added, total } = await importData(parsed);
      toast(added
        ? `Added ${pluralise(added, 'recipe')}. ${total} in the box now.`
        : 'Nothing new in that file — everything in it was already here.');
      rerender();
    } catch (err) {
      toast(err.message || "Couldn't read that file.", { bad: true });
    }
  }, { once: true });

  picker.click();
}

/* ---------------------------------------------------------------- about --- */

function openAbout(onDevice) {
  openSheet({
    title: onDevice ? 'Adding recipes, and sharing them' : 'How importing works',
    body: el('div', { style: { lineHeight: '1.6', fontSize: '14.5px' } },
      onDevice ? deviceParagraphs() : serverParagraphs()),
  });
}

function deviceParagraphs() {
  return [
    para('Where your recipes are',
      'In this browser, on this device. Nothing is uploaded and no account exists, which is why '
      + 'it works with no setup at all — and why clearing this site’s data would take the '
      + 'recipes with it. Download a backup now and then.'),
    para('Getting them onto another phone',
      'Download a backup here, send yourself the file, and use "Open a backup" on the other '
      + 'device. It merges, so you can do it repeatedly without making duplicates — but the two '
      + 'devices don’t stay in step on their own. That needs a server.'),
    para('Why photo and link importing are off',
      'Reading a screenshot needs an API key, and a key in a public web page is a key anyone can '
      + 'take and spend. Fetching a recipe site from a browser is blocked by that site. Both work '
      + 'as soon as there’s a server in the picture; until then, typing a recipe in takes about '
      + 'a minute and everything else in the app works normally.'),
    para('Moving to a shared box later',
      'A backup taken here opens on a server version without changing anything — a recipe is the '
      + 'same shape in both. Nothing you type in now is wasted.'),
  ];
}

function serverParagraphs() {
  return [
    para('Recipe websites',
      'Nearly every food site publishes its recipes in a machine-readable form so Google can show '
      + 'recipe cards. When one does, you get it exactly — right quantities, right steps — and no '
      + 'model is involved at all. When it does not, the page text is read instead.'),
    para('TikTok, Instagram and YouTube',
      'These give us the caption or description, not the video. Nobody is watching or transcribing '
      + 'the footage. When the creator wrote the recipe out — and food creators usually do, so '
      + 'people can save it — this works well. When the recipe only exists in the voiceover or '
      + 'on-screen text, the import says so rather than making it up.'),
    para('Photos',
      'Anything readable: a cookbook page, a handwritten card, a screenshot of a post. Multiple '
      + 'photos of one recipe are read together, in order. This is the fallback that always works, '
      + 'including for reels — screenshot the on-screen steps.'),
    para('Every import lands in the editor first',
      "Nothing saves until you've looked at it. Quantities and temperatures are the things worth "
      + 'checking; a missing one shows as blank rather than a guess.'),
  ];
}

function para(title, body) {
  return el('div', { style: { marginBottom: '16px' } },
    el('h4', { text: title, style: { fontSize: '14px', marginBottom: '4px' } }),
    el('p.muted', { text: body, style: { margin: 0, fontSize: '14px' } }));
}
