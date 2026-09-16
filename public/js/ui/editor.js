/**
 * The editor — for typing a recipe in, and for fixing whatever an import got
 * wrong before it's saved.
 *
 * It's the same form either way. An imported draft arrives with the fields
 * already filled and a banner explaining anything the importer wasn't sure
 * about, which is the point: every import ends here, in front of you, rather
 * than silently in the library.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, saveRecipe } from '../store.js';
import { openSheet, toast } from './sheet.js';
import { field, input, textarea, select, banner, photoPicker } from './bits.js';
import { formatQty } from '../util/format.js';

/**
 * What you actually pasted, kept to hand.
 *
 * The parser is a guess, and the guess is easier to correct with the original
 * in front of you than from memory. Collapsed, because most of the time it
 * got it right and you don't want to scroll past it.
 */
function originalBlock(text) {
  const pre = el('pre', {
    text,
    style: {
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '10px 0 0',
      fontSize: '12.5px', lineHeight: '1.5', color: 'var(--text-2)',
      background: 'var(--surface-2)', padding: '12px',
      borderRadius: 'var(--radius-sm)', maxHeight: '260px', overflowY: 'auto',
    },
  });

  const details = el('details', { style: { marginTop: '22px' } },
    el('summary', {
      text: 'What you pasted',
      style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-2)', cursor: 'pointer' },
    }),
    pre);
  return details;
}

/**
 * openEditor({ recipe }) to edit an existing one,
 * openEditor({ draft, warning }) to review an import.
 */
export function openEditor({ recipe = null, draft = null, warning = null, originalText = null, onSaved } = {}) {
  const source = recipe || draft || {};
  const isNew = !recipe?.id;

  const titleInput = input({ value: source.title || '', placeholder: 'What is it called?' });
  const descInput = textarea({ value: source.description || '', placeholder: 'A line about it (optional)', rows: 2 });
  const categorySelect = select(state.categories, { value: source.category || 'mains' });
  const cuisineInput = input({ value: source.cuisine || '', placeholder: 'Italian, Thai…' });

  const servingsInput = input({
    type: 'number', inputmode: 'decimal', min: '0', step: '0.5',
    value: source.servings ?? '', placeholder: '4',
  });
  const servingsUnitInput = input({ value: source.servingsUnit || source.servings_unit || 'servings' });
  const prepInput = input({ type: 'number', inputmode: 'numeric', min: '0', value: source.prepMin ?? source.prep_min ?? '', placeholder: '15' });
  const cookInput = input({ type: 'number', inputmode: 'numeric', min: '0', value: source.cookMin ?? source.cook_min ?? '', placeholder: '40' });
  const tagsInput = input({ value: (source.tags || []).join(', '), placeholder: 'vegetarian, quick' });

  let photoId = source.photoId ?? null;
  const ingredientsBox = el('div');
  const stepsBox = el('div');

  const ingredientRows = [];
  const stepRows = [];

  /* ------------------------------------------------------- ingredients --- */

  function addIngredient(value = {}, focus = false) {
    const qty = input({
      class: 'qty-in', type: 'text', inputmode: 'decimal',
      value: value.qty === null || value.qty === undefined ? '' : formatQty(value.qty),
      placeholder: '2', 'aria-label': 'Quantity',
    });
    const unit = input({ class: 'unit-in', value: value.unit || '', placeholder: 'cup', 'aria-label': 'Unit' });
    const item = input({ class: 'grow', value: value.item || '', placeholder: 'Ingredient', 'aria-label': 'Ingredient' });

    const row = el('div.edit-row', qty, unit, item,
      el('button.del', {
        type: 'button', 'aria-label': 'Remove ingredient',
        onclick: () => {
          row.remove();
          const index = ingredientRows.findIndex((r) => r.row === row);
          if (index !== -1) ingredientRows.splice(index, 1);
        },
      }, svg(ICONS.x, { size: 15 })));

    // Enter at the end of a row makes the next one — typing a list shouldn't
    // mean reaching for a button between every line.
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addIngredient({ group: value.group }, true);
      }
    });

    ingredientRows.push({ row, qty, unit, item, group: value.group || null });
    ingredientsBox.append(row);
    if (focus) item.focus();
  }

  function addStep(value = {}, focus = false) {
    const body = textarea({ class: 'grow', value: value.text || '', placeholder: 'What do you do?', rows: 2 });
    const row = el('div.edit-row',
      el('span.n', {
        text: String(stepRows.length + 1),
        style: {
          flex: 'none', width: '24px', height: '24px', borderRadius: '999px',
          background: 'var(--accent-soft)', color: 'var(--accent-deep)',
          display: 'grid', placeItems: 'center', fontSize: '12px',
          fontWeight: '800', marginTop: '9px',
        },
      }),
      body,
      el('button.del', {
        type: 'button', 'aria-label': 'Remove step',
        onclick: () => {
          row.remove();
          const index = stepRows.findIndex((r) => r.row === row);
          if (index !== -1) stepRows.splice(index, 1);
          renumber();
        },
      }, svg(ICONS.x, { size: 15 })));

    stepRows.push({ row, body, group: value.group || null });
    stepsBox.append(row);
    renumber();
    if (focus) body.focus();
  }

  function renumber() {
    stepRows.forEach(({ row }, index) => {
      const badge = row.querySelector('span');
      if (badge) badge.textContent = String(index + 1);
    });
  }

  for (const ing of source.ingredients || []) addIngredient(ing);
  for (const step of source.steps || []) addStep(step);
  if (!ingredientRows.length) addIngredient();
  if (!stepRows.length) addStep();

  /* ------------------------------------------------------------- collect --- */

  function collect() {
    const num = (node) => {
      const raw = node.value.trim();
      if (!raw) return null;
      // Accept "1 1/2" and "1/2" as well as decimals, since that's how
      // quantities are actually written on a recipe card.
      const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw);
      if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
      const fraction = /^(\d+)\/(\d+)$/.exec(raw);
      if (fraction) return Number(fraction[1]) / Number(fraction[2]);
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    return {
      id: recipe?.id,
      title: titleInput.value.trim(),
      description: descInput.value.trim(),
      category: categorySelect.value,
      cuisine: cuisineInput.value.trim(),
      servings: servingsInput.value ? Number(servingsInput.value) : null,
      servings_unit: servingsUnitInput.value.trim() || 'servings',
      prep_min: prepInput.value ? Number(prepInput.value) : null,
      cook_min: cookInput.value ? Number(cookInput.value) : null,
      ingredients: ingredientRows
        .map(({ qty, unit, item, group }) => ({
          qty: num(qty), unit: unit.value.trim(), item: item.value.trim(), group,
        }))
        .filter((ing) => ing.item),
      steps: stepRows
        .map(({ body, group }) => ({ text: body.value.trim(), group }))
        .filter((step) => step.text),
      tags: tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
      sourceType: source.sourceType || 'manual',
      sourceUrl: source.sourceUrl || null,
      sourceName: source.sourceName || null,
      sourceNote: source.sourceNote || source.source_note || null,
      photoId,
    };
  }

  /* ---------------------------------------------------------------- UI --- */

  const saveButton = el('button.btn.btn-primary', { type: 'button', text: isNew ? 'Add to the box' : 'Save changes' });

  const sheet = openSheet({
    title: isNew ? 'New recipe' : 'Edit recipe',
    body: el('div',
      warning ? banner(warning, 'warn') : null,
      photoPicker({
        photoId,
        onChange: (id) => { photoId = id; },
        label: 'Add a photo of the dish',
      }),

      field('Name', titleInput),
      field('Description', descInput),
      el('div.field-row', field('Category', categorySelect), field('Cuisine', cuisineInput)),
      el('div.field-row', field('Makes', servingsInput), field('Of what', servingsUnitInput)),
      el('div.field-row', field('Prep (min)', prepInput), field('Cook (min)', cookInput)),

      el('div.section-title', { text: 'Ingredients' }),
      ingredientsBox,
      el('button.btn.btn-ghost', { type: 'button', onclick: () => addIngredient({}, true) },
        svg(ICONS.plus, { size: 16 }), 'Add ingredient'),

      el('div.section-title', { text: 'Method' }),
      stepsBox,
      el('button.btn.btn-ghost', { type: 'button', onclick: () => addStep({}, true) },
        svg(ICONS.plus, { size: 16 }), 'Add step'),

      el('div.section-title', { text: 'Tags' }),
      tagsInput,

      source.sourceName && !originalText
        ? el('p.tiny.muted', { style: { marginTop: '18px' }, text: `From ${source.sourceName}` })
        : null,

      originalText ? originalBlock(originalText) : null),
    footer: saveButton,
  });

  saveButton.onclick = async () => {
    const payload = collect();
    if (!payload.title) {
      toast('It needs a name.', { bad: true });
      titleInput.focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const saved = await saveRecipe(payload);
      sheet.close();
      toast(isNew ? 'Added to the box.' : 'Saved.');
      onSaved?.(saved);
    } catch (err) {
      toast(err.message, { bad: true });
      saveButton.disabled = false;
      saveButton.textContent = isNew ? 'Add to the box' : 'Save changes';
    }
  };

  if (isNew && !source.title) setTimeout(() => titleInput.focus(), 180);
  return sheet;
}
