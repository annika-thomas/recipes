/**
 * The app shell: routing, the tab bar, and deciding what to draw.
 *
 * Routes live in the hash so the whole thing is one static page — which is what
 * lets an iOS Shortcut deep-link straight to "add this link" without any native
 * plumbing.
 */

import { el, svg, replace } from './util/dom.js';
import { ICONS } from './ui/icons.js';
import { state, subscribe, loadSession, refresh } from './store.js';
import { renderGate } from './ui/gate.js';
import { renderLibrary } from './ui/library.js';
import { renderRecipe } from './ui/recipe.js';
import { renderCalendar } from './ui/calendar.js';
import { renderKitchen } from './ui/kitchen.js';
import { renderSettings, applyStoredTheme } from './ui/settings.js';
import { openAddSheet, openLinkImport } from './ui/add.js';
import { closeAllSheets, toast } from './ui/sheet.js';

const app = document.getElementById('app');

const TABS = [
  { id: 'recipes', label: 'Recipes', icon: 'book', title: 'Kitchen' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', title: 'What we made' },
  { id: 'kitchen', label: 'Kitchen', icon: 'fridge', title: 'In the house' },
  { id: 'settings', label: 'Settings', icon: 'cog', title: 'Settings' },
];

/* ---------------------------------------------------------------- routing --- */

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  if (name === 'recipe' && param) return { name: 'recipe', id: param };
  if (TABS.some((t) => t.id === name)) return { name };
  if (name === 'add') return { name: 'recipes', add: true };
  return { name: 'recipes' };
}

function go(hash, { replaceState = false } = {}) {
  if (replaceState) history.replaceState(null, '', `#/${hash}`);
  else location.hash = `#/${hash}`;
}

const openRecipe = (id) => go(`recipe/${id}`);

function back() {
  // Coming in from a Shortcut there's no history to go back to.
  if (history.length > 1) history.back();
  else go('recipes', { replaceState: true });
}

/* ----------------------------------------------------------------- render --- */

let pendingFocus = null;

function rerender(options = {}) {
  pendingFocus = options.keepFocus || null;
  draw();
}

function draw() {
  const route = currentRoute();

  if (!state.person) {
    replace(app, renderGate(() => {
      go('recipes', { replaceState: true });
      draw();
    }));
    return;
  }

  const screen = el('div.screen');
  const actions = el('div.row', { style: { gap: '8px' } });
  const titleNode = el('h1');
  const appbar = el('div.appbar');

  let result;
  try {
    result = renderRoute(route, screen);
  } catch (err) {
    console.error(err);
    result = { body: el('p.muted', { text: 'Something went wrong drawing that screen.' }) };
  }

  if (route.name === 'recipe') {
    appbar.append(
      el('button.icon-btn', { type: 'button', 'aria-label': 'Back', onclick: back }, svg(ICONS.back, { size: 19 })),
      el('span.grow'),
    );
  } else {
    titleNode.textContent = TABS.find((t) => t.id === route.name)?.title || 'Kitchen';
    appbar.append(titleNode);
  }

  for (const action of result.appbarActions || []) actions.append(action);
  appbar.append(actions);

  replace(screen, result.body);
  replace(app, appbar, screen, tabbar(route));

  result.focus?.();
  if (pendingFocus) pendingFocus = null;
}

function renderRoute(route, screen) {
  if (route.name === 'recipe') {
    return renderRecipe(route.id, { onBack: back, rerender });
  }
  if (route.name === 'calendar') {
    return renderCalendar({ onOpen: openRecipe, rerender });
  }
  if (route.name === 'kitchen') {
    return renderKitchen({ onOpen: openRecipe, rerender });
  }
  if (route.name === 'settings') {
    return renderSettings({
      onSignedOut: () => { go('recipes', { replaceState: true }); draw(); },
      rerender,
    });
  }
  return renderLibrary({ onOpen: openRecipe, rerender, screen });
}

function tabbar(route) {
  const active = route.name === 'recipe' ? 'recipes' : route.name;
  const inner = el('div.tabbar-inner');

  const tabButton = (tab) => el('button.tab', {
    type: 'button',
    'aria-current': active === tab.id ? 'page' : null,
    onclick: () => {
      closeAllSheets();
      go(tab.id);
    },
  }, svg(ICONS[tab.icon], { size: 22 }), el('span', { text: tab.label }));

  inner.append(tabButton(TABS[0]), tabButton(TABS[1]));
  inner.append(el('div.tab-add',
    el('button', {
      type: 'button',
      'aria-label': 'Add a recipe',
      onclick: () => openAddSheet({ onSaved: onRecipeSaved }),
    }, svg(ICONS.plus, { size: 26, width: 2.6 }))));
  inner.append(tabButton(TABS[2]), tabButton(TABS[3]));

  return el('nav.tabbar', inner);
}

function onRecipeSaved(recipe) {
  if (recipe?.id) go(`recipe/${recipe.id}`);
  else draw();
}

/* -------------------------------------------------------------- shortcuts --- */

/**
 * ?add=<url> opens the link importer straight away.
 *
 * This is the hook the iOS Share Sheet shortcut uses: share a reel, the
 * shortcut opens the app with the URL attached, and the import is already
 * running by the time you look at the screen.
 */
function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  const shared = params.get('add') || params.get('url');
  if (!shared) return;

  // Strip it so a reload doesn't import the same thing twice.
  history.replaceState(null, '', location.pathname + location.hash);

  const run = () => openLinkImport(onRecipeSaved, shared);
  if (state.person) setTimeout(run, 300);
  else pendingShare = run;
}

let pendingShare = null;

/* ------------------------------------------------------------------- boot --- */

applyStoredTheme();
window.addEventListener('hashchange', () => { closeAllSheets(); draw(); });

/**
 * Screens redraw themselves after anything they triggered, so the store isn't
 * driving rendering. The one thing it has to drive is losing the session: a
 * request can come back 401 at any moment (the cookie expired, or the passcode
 * changed), and leaving a dead screen up is how you lose what you were typing
 * without being told why.
 */
let wasSignedIn = false;
subscribe((next) => {
  if (wasSignedIn && !next.person) {
    closeAllSheets();
    toast(state.mode === 'local'
      ? 'Tell it who you are again.'
      : 'Signed out — type the passcode again.', { bad: true });
    draw();
  }
  wasSignedIn = Boolean(next.person);
});

/** Coming back to the app should show what your partner did while you were away. */
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.person) return;
  if (Date.now() - lastRefresh < 20_000) return;
  lastRefresh = Date.now();
  try {
    await refresh();
    draw();
  } catch { /* offline; what's on screen is still usable */ }
});

(async function boot() {
  try {
    await loadSession();
  } catch {
    replace(app, el('div.gate',
      el('div.mark', { text: '🍲' }),
      el('h1', { text: 'Kitchen' }),
      el('p', { text: "Can't reach the server. Check your signal and pull down to reload." })));
    return;
  }

  handleLaunchParams();

  if (state.person) {
    try {
      await refresh();
    } catch (err) {
      toast(err.message, { bad: true });
    }
  }

  draw();

  if (pendingShare && state.person) {
    setTimeout(pendingShare, 300);
    pendingShare = null;
  }

  if ('serviceWorker' in navigator) {
    // Registered after first paint so it never delays the app appearing.
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
