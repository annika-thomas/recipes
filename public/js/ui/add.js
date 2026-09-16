/**
 * Getting a recipe in, from the phone's point of view.
 *
 * Four ways, one sheet. Whichever you pick, the result is a filled-in editor
 * you look at before it saves — an import is a good guess, not a fact, and the
 * moment to catch a missing oven temperature is before you're preheating.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, importPhotos, importLink, importText } from '../store.js';
import { openSheet, toast } from './sheet.js';
import { openEditor } from './editor.js';
import { spinner, banner, field, input, textarea } from './bits.js';

export function openAddSheet({ onSaved } = {}) {
  // With no server there is nothing to read a screenshot or fetch a page, so
  // those doors are shown closed rather than failing after you've picked a
  // photo. "Type it in" always works, everywhere.
  const canRead = state.canImport;

  const sheet = openSheet({
    title: 'Add a recipe',
    body: el('div',
      importNotice(),

      option('pencil', 'Type it in', 'A family recipe, or something you worked out yourself. Enter jumps to the next ingredient.',
        () => { sheet.close(); openEditor({ onSaved }); }),

      option('camera', 'Photo or screenshot', canRead
        ? 'A cookbook page, a recipe card, a screenshot of a post. Several photos of one recipe are fine.'
        : 'Needs a server to read the picture.',
        () => { sheet.close(); openPhotoImport(onSaved); }, canRead),

      option('link', 'A link', canRead
        ? 'A recipe site, or a TikTok, Instagram or YouTube post. It works out which and reads it.'
        : "Needs a server — a browser isn't allowed to fetch other sites.",
        () => { sheet.close(); openLinkImport(onSaved); }, canRead),

      option('text', 'Paste some text', canRead
        ? 'Someone sent you the recipe in a message, or you copied a caption.'
        : 'Needs a server to turn the text into a recipe.',
        () => { sheet.close(); openTextImport(onSaved); }, canRead)),
  });
  return sheet;
}

/** Why the greyed-out options are greyed out, in one line. */
function importNotice() {
  if (state.canImport) return null;

  if (state.mode === 'local') {
    return banner(
      'This copy keeps recipes on your device, so the three ways of reading a recipe for you '
      + "are off — they all need a server. Typing one in works, and it's how the box gets started.",
      'info',
    );
  }
  return banner(
    'Importing is off — the server has no Anthropic API key yet. Typing recipes in still works.',
    'warn',
  );
}

function option(icon, title, body, onclick, enabled = true) {
  return el('button.option', {
    type: 'button',
    onclick: enabled ? onclick : undefined,
    disabled: !enabled,
    style: enabled ? null : { opacity: '.5' },
  },
    el('div.ico', svg(ICONS[icon], { size: 21 })),
    el('div.grow', el('h4', { text: title }), el('p', { text: body })));
}

/* ------------------------------------------------------------ the photo --- */

function openPhotoImport(onSaved) {
  const picker = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp,image/*',
    multiple: true,
    hidden: true,
  });
  document.body.append(picker);

  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.remove();
    if (!files.length) return;

    const sheet = openSheet({
      title: 'Reading that',
      body: spinner(files.length > 1
        ? `Reading ${files.length} photos as one recipe…`
        : 'Reading the recipe off that photo…'),
      dismissible: false,
    });

    try {
      const prepared = await Promise.all(files.slice(0, 6).map(prepareImage));
      const result = await importPhotos(prepared);
      sheet.close();
      review(result, onSaved);
    } catch (err) {
      sheet.close();
      failed(err, () => openPhotoImport(onSaved));
    }
  }, { once: true });

  picker.click();
}

/**
 * Shrink and re-encode before upload.
 *
 * Two reasons, both practical: a modern phone photo is 4MB and reading it costs
 * more than it needs to, and iPhones shoot HEIC by default, which the model
 * can't read at all. Drawing it to a canvas fixes both — Safari decodes HEIC
 * happily, it just won't send it.
 */
async function prepareImage(file) {
  const MAX = 1600;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('no blob');

    return new File([blob], (file.name || 'recipe').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    // Old browser, or a format canvas won't take. Send the original and let
    // the server say something useful if it can't read it.
    return file;
  }
}

/* ------------------------------------------------------------- the link --- */

export function openLinkImport(onSaved, prefill = '') {
  const urlInput = input({
    type: 'url',
    inputmode: 'url',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
    placeholder: 'https://…',
    value: prefill,
    enterkeyhint: 'go',
  });

  const button = el('button.btn.btn-primary', { type: 'button', text: 'Read it' });

  const sheet = openSheet({
    title: 'Import from a link',
    body: el('div',
      field('Link', urlInput),
      el('p.tiny.muted', { style: { lineHeight: '1.55', margin: '2px 2px 0' } },
        'Recipe sites come through whole — most of them publish the recipe in a form this can read exactly. ',
        'TikTok, Instagram and YouTube links give us the ',
        el('strong', { text: 'caption' }),
        ", not the video, so they work when the creator wrote the recipe out and fall short when they didn't.")),
    footer: button,
  });

  const run = async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    sheet.setBody(spinner(looksSocial(url)
      ? 'Fetching that post and reading the caption…'
      : 'Fetching that page…'));
    sheet.setFooter();

    try {
      const result = await importLink(url);
      sheet.close();
      review(result, onSaved);
    } catch (err) {
      sheet.close();
      failed(err, () => openLinkImport(onSaved, url));
    }
  };

  button.onclick = run;
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); run(); }
  });

  if (!prefill) setTimeout(() => urlInput.focus(), 200);
  return sheet;
}

function looksSocial(url) {
  return /tiktok\.com|instagram\.com|instagr\.am|youtube\.com|youtu\.be/i.test(url);
}

/* ------------------------------------------------------------- the text --- */

function openTextImport(onSaved) {
  const body = textarea({ placeholder: 'Paste the recipe — a message, a caption, anything.', rows: 9 });
  const sourceInput = input({ placeholder: "Where's it from? (optional)" });
  const button = el('button.btn.btn-primary', { type: 'button', text: 'Read it' });

  const sheet = openSheet({
    title: 'Paste a recipe',
    body: el('div', field('The recipe', body), field('Source', sourceInput)),
    footer: button,
  });
  setTimeout(() => body.focus(), 200);

  button.onclick = async () => {
    const value = body.value.trim();
    if (value.length < 20) {
      toast('Paste a bit more than that.', { bad: true });
      return;
    }
    sheet.setBody(spinner('Reading that…'));
    sheet.setFooter();

    try {
      const result = await importText(value, sourceInput.value.trim());
      sheet.close();
      review(result, onSaved);
    } catch (err) {
      sheet.close();
      failed(err, () => openTextImport(onSaved));
    }
  };
}

/* ----------------------------------------------------------- the result --- */

function review(result, onSaved) {
  openEditor({
    draft: result.draft,
    warning: result.warning,
    onSaved,
  });
}

/**
 * When an import fails, say what happened and offer the next thing to try —
 * the server's errors are written to be read by a person, so they go through
 * verbatim rather than being flattened into "something went wrong".
 */
function failed(err, retry) {
  const sheet = openSheet({
    title: "That didn't work",
    body: el('div',
      banner(err.message || 'The import failed.', 'error'),
      el('p.tiny.muted', { style: { lineHeight: '1.55' } },
        'A screenshot almost always works when a link does not — it reads whatever is on the screen, '
        + 'including the text burned into a reel.')),
    footer: (handle) => [
      el('button.btn.btn-ghost', { type: 'button', text: 'Close', onclick: () => handle.close() }),
      el('button.btn.btn-primary', {
        type: 'button',
        text: 'Try again',
        onclick: () => { handle.close(); retry(); },
      }),
    ],
  });
  return sheet;
}
