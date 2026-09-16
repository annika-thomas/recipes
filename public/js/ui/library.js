/**
 * The recipe box itself.
 *
 * Search, then category chips, then the list. The sort is deliberately not
 * "newest first": what you want on a Tuesday is usually something you've made
 * before and liked, so rated-and-cooked floats up, and the sort control lets
 * you say otherwise.
 */

import { el, svg, debounce } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, categoryCounts, averageStars } from '../store.js';
import { recipeCard, emptyState } from './bits.js';
import { openSheet } from './sheet.js';

const SORTS = [
  { id: 'best', label: 'Favourites first' },
  { id: 'recent', label: 'Recently added' },
  { id: 'cooked', label: 'Recently cooked' },
  { id: 'untried', label: 'Never made' },
  { id: 'title', label: 'A to Z' },
];

/** Survives tab switches within a session; deliberately not persisted. */
const view = { query: '', category: null, sort: 'best' };

function searchText(recipe) {
  return [
    recipe.title,
    recipe.description,
    recipe.cuisine,
    recipe.sourceName,
    recipe.tags?.join(' '),
    recipe.ingredients?.map((i) => i.item).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

function matches(recipe, query) {
  if (!query) return true;
  const haystack = searchText(recipe);
  // Every word has to appear somewhere — "chicken lemon" finds the one recipe
  // with both, not everything with either.
  return query.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

function sortRecipes(recipes, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title);

  if (sort === 'title') return [...recipes].sort(byTitle);
  if (sort === 'recent') return [...recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === 'untried') {
    return [...recipes]
      .filter((r) => !r.timesCooked)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (sort === 'cooked') {
    return [...recipes]
      .filter((r) => r.lastCooked)
      .sort((a, b) => b.lastCooked.localeCompare(a.lastCooked));
  }

  // "Favourites first": rating leads, then how often you've actually made it.
  return [...recipes].sort((a, b) => {
    const ra = averageStars(a);
    const rb = averageStars(b);
    if (ra !== rb) return (rb ?? -1) - (ra ?? -1);
    if (b.timesCooked !== a.timesCooked) return b.timesCooked - a.timesCooked;
    return byTitle(a, b);
  });
}

export function renderLibrary({ onOpen, rerender }) {
  const counts = categoryCounts();
  const filtered = state.recipes.filter((r) => matches(r, view.query.toLowerCase().trim()))
    .filter((r) => !view.category || r.category === view.category);
  const sorted = sortRecipes(filtered, view.sort);

  /* Search */
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Search recipes and ingredients',
    'aria-label': 'Search recipes',
    value: view.query,
    enterkeyhint: 'search',
    oninput: debounce((event) => {
      view.query = event.target.value;
      rerender({ keepFocus: 'search' });
    }, 140),
  });

  const searchbar = el('div.searchbar',
    svg(ICONS.search, { size: 18 }),
    searchInput,
    view.query
      ? el('button.clear', {
        type: 'button',
        'aria-label': 'Clear search',
        onclick: () => { view.query = ''; rerender(); },
      }, svg(ICONS.x, { size: 16 }))
      : null);

  /* Category chips */
  const chip = (id, label, count) => el('button.chip', {
    type: 'button',
    'aria-pressed': String(view.category === id),
    onclick: () => { view.category = view.category === id ? null : id; rerender(); },
  }, label, count ? el('span.count', { text: String(count) }) : null);

  const chips = el('div.chips',
    el('button.chip', {
      type: 'button',
      'aria-pressed': String(view.category === null),
      onclick: () => { view.category = null; rerender(); },
    }, 'All', el('span.count', { text: String(state.recipes.length) })),
    state.categories
      .filter((category) => counts.get(category.id))
      .map((category) => chip(category.id, category.label, counts.get(category.id))));

  /* List */
  const list = sorted.length
    ? el('div.recipe-list', sorted.map((recipe) => recipeCard(recipe, onOpen)))
    : emptyResult();

  return {
    body: el('div', searchbar, chips, listHeader(sorted.length, rerender), list),
    focus: () => {
      if (!view.query) return;
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    },
  };
}

function listHeader(count, rerender) {
  if (!state.recipes.length) return null;
  const sortLabel = SORTS.find((s) => s.id === view.sort)?.label || '';

  return el('div.row-between', { style: { padding: '2px 2px 12px' } },
    el('span.tiny.muted', { text: `${count} ${count === 1 ? 'recipe' : 'recipes'}` }),
    el('button.tiny', {
      type: 'button',
      style: { color: 'var(--accent)', fontWeight: '700' },
      onclick: () => openSortSheet(rerender),
    }, sortLabel, ' ▾'));
}

function openSortSheet(rerender) {
  const sheet = openSheet({
    title: 'Sort by',
    body: el('div', SORTS.map((sort) => el('button.option', {
      type: 'button',
      onclick: () => { view.sort = sort.id; sheet.close(); rerender(); },
    },
      el('div.grow', el('h4', { text: sort.label })),
      view.sort === sort.id ? svg(ICONS.check, { size: 18 }) : null))),
  });
}

function emptyResult() {
  if (!state.recipes.length) {
    return emptyState({
      emoji: '🍲',
      title: 'Nothing in the box yet',
      body: 'Tap the + below to add the first one — a screenshot, a link, a reel, or type it in yourself.',
    });
  }
  if (view.query) {
    return emptyState({
      emoji: '🔍',
      title: 'No matches',
      body: `Nothing here mentions "${view.query}".`,
    });
  }
  return emptyState({
    emoji: '🍽️',
    title: 'Nothing in this category',
    body: 'Try another one, or add a recipe here.',
  });
}
