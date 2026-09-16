/** Settings — who you are, how it looks, and getting your data in and out. */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import {
  state, signOut, refresh, exportData, importData,
  lastBackup, markBackedUp, recoverable, recover,
} from '../store.js';
import { openSheet, confirmSheet, toast } from './sheet.js';
import { forgetPerson } from './gate.js';
import { pluralise } from '../util/format.js';
import { banner } from './bits.js';
import { storageEstimate } from '../backends/photos.js';
import { persistence } from '../backends/persist.js';

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
      onDevice ? recoveryOffer(rerender) : null,
      onDevice ? backupWarning() : null,
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

        el('button.setting', { type: 'button', onclick: () => { exportBackup(onDevice); rerender(); } },
          el('div.grow',
            el('h4', { text: 'Download a backup' }),
            el('p', { text: onDevice ? backupLine() : 'Every recipe, rating, note and cook as one file.' })),
          svg(ICONS.download, { size: 18 })),

        onDevice ? el('button.setting', { type: 'button', onclick: () => openRestore(rerender) },
          el('div.grow',
            el('h4', { text: 'Open a backup' }),
            el('p', { text: 'Add recipes from a backup file — how you move them to another device.' })),
          svg(ICONS.share, { size: 18 })) : null,

        el('button.setting', { type: 'button', onclick: () => openAbout(onDevice) },
          el('div.grow',
            el('h4', { text: 'How this works' }),
            el('p', { text: 'Where your recipes live, and how pasting reads them.' })),
          svg(ICONS.next, { size: 18 }))),

      storageLine(),

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
    markBackedUp();
    toast('Saved. Keep it somewhere off this phone — that file is the only copy that survives this app being deleted.');
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
    title: 'How this works',
    body: el('div', { style: { lineHeight: '1.6', fontSize: '14.5px' } },
      para('Pasting a recipe',
        'The text is read here in your browser — nothing is sent anywhere and there is no '
        + 'waiting. It looks for the things recipes always have: quantities and units at the '
        + 'start of a line, numbered steps, headings like Ingredients and Method. Give it any '
        + 'of those and it does well; give it a paragraph of prose and it will do its best and '
        + 'tell you what it could not find.'),
      para('Why it always opens the form',
        'Because it is a guess. Quantities and oven temperatures are the parts nobody proofreads '
        + 'and the parts that ruin dinner, so the parsed recipe is shown to you before it is '
        + 'saved, with what you pasted kept underneath it.'),
      para('Photos',
        'Pictures of the dish are kept on this device, alongside the recipes but in separate '
        + 'storage sized for them. Each time you cook something you can add a photo of how it '
        + 'turned out that time — that is what the calendar shows.'),
      onDevice
        ? para('Where your recipes are',
          'In this browser, on this device. Nothing is uploaded and no account exists, which is '
          + 'why it needs no setup at all — and why clearing this site\u2019s data would take the '
          + 'recipes with it. Download a backup now and then; opening one on another device '
          + 'merges rather than overwrites, so you can do it as often as you like.')
        : para('Where your recipes are',
          'On your own server, shared between both of you. Anything either of you adds shows up '
          + 'for the other.')),
  });
}

/* ----------------------------------------------------- not losing it --- */

/** "3 days ago", near enough for deciding whether to take another backup. */
function sinceBackup() {
  const when = lastBackup();
  if (!when) return null;
  const days = Math.floor((Date.now() - Date.parse(when)) / 86_400_000);
  if (days <= 0) return { days, text: 'today' };
  if (days === 1) return { days, text: 'yesterday' };
  if (days < 30) return { days, text: `${days} days ago` };
  return { days, text: 'over a month ago' };
}

function backupLine() {
  const since = sinceBackup();
  if (!since) return `${countsLine()} Never backed up.`;
  return `${countsLine()} Last backup ${since.text}.`;
}

/**
 * Say so when the only copy is one uninstall away from gone.
 *
 * Deleting the home-screen app takes its storage with it, and so does clearing
 * site data — neither asks twice, and neither is undoable. The backup file is
 * the only thing that survives either, so this gets loud once there is enough
 * in the box to be worth losing.
 */
function backupWarning() {
  if (!state.recipes.length) return null;
  const since = sinceBackup();
  if (since && since.days < 14) return null;

  return el('div', { style: { marginBottom: '4px' } },
    banner(
      since
        ? `Last backup was ${since.text}. Deleting this app from your home screen, or clearing `
          + 'site data, erases everything since then — a backup file is the only copy that survives it.'
        : 'No backup yet. Deleting this app from your home screen, or clearing site data, would '
          + 'erase every recipe here — a backup file is the only copy that survives it.',
      'warn',
    ));
}

/** Offer back recipes the box lost that the previous copy still has. */
function recoveryOffer(rerender) {
  const found = recoverable();
  if (!found) return null;

  return el('div', { style: { marginBottom: '10px' } },
    banner(`${pluralise(found.count, 'recipe')} from just before the last change `
      + 'can still be put back.', 'info'),
    el('button.btn.btn-primary.btn-block', {
      type: 'button',
      style: { marginTop: '8px' },
      text: `Put ${found.count === 1 ? 'it' : 'them'} back`,
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          const { added } = await recover();
          toast(added ? `${pluralise(added, 'recipe')} back.` : 'Nothing was missing.');
          rerender();
        } catch (err) {
          toast(err.message, { bad: true });
        }
      },
    }));
}

/** How much room the photos are taking, and whether the browser will keep it. */
function storageLine() {
  const line = el('p.tiny.muted', {
    style: { margin: '16px 4px 0', lineHeight: '1.5' },
    hidden: true,
  });

  const show = (textContent) => {
    line.textContent = textContent;
    line.hidden = false;
  };

  storageEstimate().then((info) => {
    const parts = [];
    if (info && info.usage >= 2_000_000) {
      const mb = (n) => `${(n / 1_000_000).toFixed(0)}MB`;
      parts.push(`Using ${mb(info.usage)} on this device`
        + (info.quota ? ` of about ${mb(info.quota)} available.` : '.'));
    }
    /*
      Only worth saying when the answer is no. "Granted" is the expected case
      and reads as reassurance nobody asked for; "not granted" means the
      browser may clear the box on its own, which is worth a line.
    */
    if (persistence.supported && persistence.asked && !persistence.granted) {
      parts.push('This browser hasn’t agreed to keep the recipes permanently, so it may '
        + 'clear them if the device runs low on space or you don’t open the app for a '
        + 'while. Keep a backup file.');
    }
    if (parts.length) show(parts.join(' '));
  }).catch(() => {});

  return line;
}

function para(title, body) {
  return el('div', { style: { marginBottom: '16px' } },
    el('h4', { text: title, style: { fontSize: '14px', marginBottom: '4px' } }),
    el('p.muted', { text: body, style: { margin: 0, fontSize: '14px' } }));
}
