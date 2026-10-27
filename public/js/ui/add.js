/**
 * Getting a recipe in. Two ways, and both end in the same editor.
 *
 * Paste something and it's read one of two ways. With a Claude API key set,
 * the text and any screenshots or photos go to Claude, which handles prose,
 * odd layouts and pictures of cookbook pages. Without one, the built-in parser
 * reads text here in the browser — no key, no waiting, but a heuristic that
 * gets messy text partly wrong.
 *
 * Either way the result opens as a filled-in form rather than saving itself:
 * the moment to catch a missing oven temperature is before you're preheating.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { openSheet, toast } from './sheet.js';
import { openEditor } from './editor.js';
import { field, input, textarea } from './bits.js';
import { parseRecipeText } from '../util/parseRecipe.js';
import { hasApiKey, readRecipe, imageForClaude, findLinks, MAX_IMAGES } from '../backends/claude.js';
import { openClaudeKeySheet } from './settings.js';

export function openAddSheet({ onSaved } = {}) {
  const sheet = openSheet({
    title: 'Add a recipe',
    body: el('div',
      option('text', 'Paste a recipe',
        hasApiKey()
          ? 'A link, text, screenshots or a photo of the page. Claude picks out the ingredients and steps for you.'
          : 'From a message, a website, a note — anywhere. It picks out the ingredients and steps for you.',
        () => { sheet.close(); openPasteSheet(onSaved); }),

      option('pencil', 'Type it in',
        'A family recipe, or something you worked it out yourself. Enter jumps to the next ingredient.',
        () => { sheet.close(); openEditor({ onSaved }); })),
  });
  return sheet;
}

function option(icon, title, body, onclick) {
  return el('button.option', { type: 'button', onclick },
    el('div.ico', svg(ICONS[icon], { size: 21 })),
    el('div.grow', el('h4', { text: title }), el('p', { text: body })));
}

/* ------------------------------------------------------------- the paste --- */

export function openPasteSheet(onSaved, prefill = '') {
  const useClaude = hasApiKey();

  const body = textarea({
    placeholder: useClaude
      ? 'Paste the recipe — text, a link to it, or a screenshot straight from the clipboard.'
      : 'Paste the whole thing — title, ingredients, method, however it came.',
    rows: 12,
    value: prefill,
  });
  const sourceInput = input({ placeholder: "Where's it from? (optional)" });
  const readLabel = useClaude ? 'Read it with Claude' : 'Read it';
  const button = el('button.btn.btn-primary', { type: 'button', text: readLabel });

  // Images waiting to be read: { file, url } so each has a preview.
  const images = [];
  const strip = el('div.paste-images');

  function renderStrip() {
    strip.replaceChildren(...images.map((image, index) => el('div.paste-image',
      el('img', { src: image.url, alt: `Image ${index + 1}` }),
      el('button', {
        type: 'button',
        'aria-label': 'Remove this image',
        onclick: () => {
          URL.revokeObjectURL(image.url);
          images.splice(index, 1);
          renderStrip();
        },
      }, svg(ICONS.x, { size: 14 })))));
    strip.hidden = !images.length;
  }

  function addImages(files) {
    for (const file of files) {
      if (!/^image\//i.test(file.type || '')) continue;
      if (images.length >= MAX_IMAGES) {
        toast(`${MAX_IMAGES} images is the most it reads at once.`, { bad: true });
        break;
      }
      images.push({ file, url: URL.createObjectURL(file) });
    }
    renderStrip();
  }

  if (useClaude) {
    // A screenshot pasted into the box becomes an image, not nothing.
    body.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.some((f) => /^image\//i.test(f.type))) return;
      event.preventDefault();
      addImages(files);
    });
  }

  function pickImages() {
    const picker = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    document.body.append(picker);
    picker.addEventListener('change', () => {
      addImages([...(picker.files || [])]);
      picker.remove();
    }, { once: true });
    picker.click();
  }

  renderStrip();

  const sheet = openSheet({
    title: 'Paste a recipe',
    onClose: () => images.forEach((image) => URL.revokeObjectURL(image.url)),
    body: el('div',
      field('The recipe', body),
      useClaude ? el('div', { style: { marginBottom: '14px' } },
        strip,
        el('button.btn.btn-ghost.btn-block', { type: 'button', onclick: pickImages },
          svg(ICONS.camera, { size: 18 }), 'Add screenshots or photos')) : null,
      field('Source', sourceInput),
      useClaude
        ? el('p.tiny.muted', { style: { lineHeight: '1.55', margin: '2px 2px 0' } },
          'Claude reads the text, any images, and the page behind a link, and fills in the form. '
          + "It's sent to Anthropic with your API key; whatever it gets wrong, you can fix on the next screen.")
        : el('p.tiny.muted', { style: { lineHeight: '1.55', margin: '2px 2px 0' } },
          'Headings like ',
          el('strong', { text: 'Ingredients' }),
          ' and ',
          el('strong', { text: 'Method' }),
          " help, but aren't needed — quantities and numbered steps are enough to go on. "
          + 'Want it to read screenshots and messy text? ',
          el('a', {
            href: '#',
            text: 'Connect Claude',
            onclick: (event) => {
              event.preventDefault();
              openClaudeKeySheet({ onDone: () => { sheet.close(); openPasteSheet(onSaved, body.value); } });
            },
          }),
          '.'),
    ),
    footer: button,
  });

  setTimeout(() => body.focus(), 200);

  const finish = (parsed, { text, warning }) => {
    parsed.sourceName = sourceInput.value.trim() || null;
    sheet.close();
    openEditor({
      draft: parsed,
      warning,
      onSaved,
      // Keeping the original means nothing is lost when the reader gets it
      // wrong — you can always look at what you actually pasted.
      originalText: text || null,
    });
  };

  button.onclick = async () => {
    const text = body.value.trim();
    const links = findLinks(text);

    if (useClaude) {
      if (!images.length && !links.length && text.length < 15) {
        toast('Paste a bit more than that, a link, or a screenshot.', { bad: true });
        body.focus();
        return;
      }

      button.disabled = true;
      button.textContent = links.length ? 'Reading the page…' : 'Reading…';
      try {
        const encoded = await Promise.all(images.map((image) => imageForClaude(image.file)));
        const parsed = await readRecipe({ text, images: encoded });
        if (links.length) {
          parsed.sourceType = 'link';
          parsed.sourceUrl = parsed.sourceUrl || links[0];
        } else if (images.length) {
          parsed.sourceType = 'photo';
        }
        finish(parsed, { text, warning: claudeNote(parsed) });
      } catch (err) {
        toast(err.message, { bad: true });
        button.disabled = false;
        button.textContent = readLabel;
      }
      return;
    }

    if (links.length && text === links[0]) {
      toast('Reading a link needs Claude — tap Connect Claude below, or paste the recipe text.', { bad: true });
      return;
    }
    if (text.length < 15) {
      toast('Paste a bit more than that.', { bad: true });
      body.focus();
      return;
    }
    const parsed = parseRecipeText(text);
    finish(parsed, { text, warning: reviewNote(parsed) });
  };

  return sheet;
}

/** The editor banner after Claude has read it. */
function claudeNote(parsed) {
  if (!parsed.found) {
    return "Claude couldn't find a recipe in that. "
      + (parsed.doubts || 'The original text, if there was any, is at the bottom of this form.');
  }
  const lead = parsed.doubts ? `Claude wasn't sure about something: ${parsed.doubts} ` : 'Read by Claude. ';
  return `${lead}Worth checking the quantities and any oven temperature.`;
}

/** What to warn about at the top of the editor, if anything. */
function reviewNote(parsed) {
  if (!parsed.ingredients.length && !parsed.steps.length) {
    return "Couldn't find a recipe in that — nothing recognisable as ingredients or steps. "
      + 'The original text is at the bottom of this form, so you can work from it.';
  }
  if (!parsed.ingredients.length) {
    return "Found the method but no ingredient list. Add the ingredients below — the original text is at the bottom.";
  }
  if (!parsed.steps.length) {
    return 'Found the ingredients but no steps. The original text is at the bottom of this form.';
  }
  if (!parsed.title) {
    return 'Give it a name — nothing in the text looked like a title.';
  }
  return 'Read from what you pasted. Worth checking the quantities and any oven temperature.';
}

/* ------------------------------------------------------------- shortcuts --- */

/**
 * The iOS Shortcut hook: share text to the app and land in the paste sheet
 * with it already in the box.
 */
export function openSharedText(onSaved, text) {
  return openPasteSheet(onSaved, text);
}
