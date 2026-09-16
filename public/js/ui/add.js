/**
 * Getting a recipe in. Two ways, and both end in the same editor.
 *
 * Paste something and it's read here in the browser — no server, no key, no
 * waiting. The parser is a heuristic and will get messy text partly wrong,
 * which is exactly why the result opens as a filled-in form rather than
 * saving itself: the moment to catch a missing oven temperature is before
 * you're preheating.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { openSheet, toast } from './sheet.js';
import { openEditor } from './editor.js';
import { field, input, textarea } from './bits.js';
import { parseRecipeText } from '../util/parseRecipe.js';

export function openAddSheet({ onSaved } = {}) {
  const sheet = openSheet({
    title: 'Add a recipe',
    body: el('div',
      option('text', 'Paste a recipe',
        'From a message, a website, a note — anywhere. It picks out the ingredients and steps for you.',
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
  const body = textarea({
    placeholder: 'Paste the whole thing — title, ingredients, method, however it came.',
    rows: 12,
    value: prefill,
  });
  const sourceInput = input({ placeholder: "Where's it from? (optional)" });
  const button = el('button.btn.btn-primary', { type: 'button', text: 'Read it' });

  const sheet = openSheet({
    title: 'Paste a recipe',
    body: el('div',
      field('The recipe', body),
      field('Source', sourceInput),
      el('p.tiny.muted', { style: { lineHeight: '1.55', margin: '2px 2px 0' } },
        'Headings like ',
        el('strong', { text: 'Ingredients' }),
        ' and ',
        el('strong', { text: 'Method' }),
        " help, but aren't needed — quantities and numbered steps are enough to go on. "
        + "Whatever it gets wrong, you can fix on the next screen."),
    ),
    footer: button,
  });

  setTimeout(() => body.focus(), 200);

  button.onclick = () => {
    const text = body.value.trim();
    if (text.length < 15) {
      toast('Paste a bit more than that.', { bad: true });
      body.focus();
      return;
    }

    const parsed = parseRecipeText(text);
    parsed.sourceName = sourceInput.value.trim() || null;

    sheet.close();
    openEditor({
      draft: parsed,
      warning: reviewNote(parsed),
      onSaved,
      // Keeping the original means nothing is lost when the parser misreads
      // it — you can always look at what you actually pasted.
      originalText: text,
    });
  };

  return sheet;
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
