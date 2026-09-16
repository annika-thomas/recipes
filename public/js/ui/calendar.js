/**
 * What you cooked, and when.
 *
 * A month grid with a dot on every day something got made, and a list under it.
 * Tap a day to see that day; swipe the grid to change months. Below the grid,
 * the same information as a timeline, because scrolling back through "what have
 * we been eating" is a different question from "what did we have on the 14th".
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { state, cooksByDate } from '../store.js';
import {
  todayKey, dateKey, fromKey, monthName, DOW_SHORT, formatDate, relativeDate, pluralise,
} from '../util/format.js';
import { emptyState, thumb } from './bits.js';

const view = { year: null, month: null, selected: null };

function ensureMonth() {
  if (view.year === null) {
    const now = new Date();
    view.year = now.getFullYear();
    view.month = now.getMonth();
  }
}

export function renderCalendar({ onOpen, rerender }) {
  ensureMonth();
  const byDate = cooksByDate();

  if (!state.cooks.length) {
    return {
      body: emptyState({
        emoji: '📅',
        title: 'Nothing logged yet',
        body: 'Open a recipe and tap "We made this". From then on this fills in, and you can see what you actually ate.',
      }),
    };
  }

  return {
    body: el('div',
      monthHeader(rerender),
      grid(byDate, rerender),
      selectedDay(byDate, onOpen, rerender),
      timeline(onOpen),
      stats()),
  };
}

function monthHeader(rerender) {
  const move = (delta) => {
    const date = new Date(view.year, view.month + delta, 1);
    view.year = date.getFullYear();
    view.month = date.getMonth();
    view.selected = null;
    rerender();
  };

  const isCurrent = view.year === new Date().getFullYear() && view.month === new Date().getMonth();

  return el('div.cal-head',
    el('button.icon-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => move(-1) },
      svg(ICONS.back, { size: 18 })),
    el('button', { type: 'button', onclick: () => { if (!isCurrent) { view.year = null; view.selected = null; rerender(); } } },
      el('h2', { text: `${monthName(view.month)} ${view.year}` })),
    el('button.icon-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => move(1) },
      svg(ICONS.next, { size: 18 })));
}

function grid(byDate, rerender) {
  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leading = first.getDay();
  const today = todayKey();

  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push(el('div.cal-day.blank'));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(new Date(view.year, view.month, day));
    const cooks = byDate.get(key) || [];
    const classes = [
      'cal-day',
      cooks.length ? 'has' : '',
      key === today ? 'today' : '',
      key > today ? 'future' : '',
      view.selected === key ? 'selected' : '',
    ].filter(Boolean).join('.');

    cells.push(el(`div.${classes}`, {
      role: cooks.length ? 'button' : null,
      tabindex: cooks.length ? '0' : null,
      'aria-label': cooks.length ? `${formatDate(key)}: ${cooks.map((c) => c.title).join(', ')}` : formatDate(key),
      onclick: () => {
        if (!cooks.length) return;
        view.selected = view.selected === key ? null : key;
        rerender();
      },
    },
      el('span', { text: String(day) }),
      cooks.length
        ? el('span.pips', cooks.slice(0, 3).map(() => el('i')))
        : null));
  }

  const wrap = el('div',
    el('div.cal-dows', DOW_SHORT.map((d) => el('span', { text: d }))),
    el('div.cal-grid', cells));

  // Swipe months, same gesture as the workouts calendar.
  let startX = 0;
  let startY = 0;
  wrap.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  wrap.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      const date = new Date(view.year, view.month + (dx < 0 ? 1 : -1), 1);
      view.year = date.getFullYear();
      view.month = date.getMonth();
      view.selected = null;
      rerender();
    }
  }, { passive: true });

  return wrap;
}

function selectedDay(byDate, onOpen, rerender) {
  if (!view.selected) return null;
  const cooks = byDate.get(view.selected) || [];
  if (!cooks.length) return null;

  return el('div',
    el('div.row-between', { style: { margin: '22px 2px 10px' } },
      el('span.section-title', { text: formatDate(view.selected, { weekday: true }), style: { margin: 0 } }),
      el('button.tiny', {
        type: 'button', style: { color: 'var(--text-3)' },
        onclick: () => { view.selected = null; rerender(); },
      }, 'Close')),
    el('div.stack', cooks.map((cook) => cookEntry(cook, onOpen))));
}

function cookEntry(cook, onOpen, { showDate = false } = {}) {
  return el('button.day-entry', {
    type: 'button',
    onclick: () => { if (!cook.recipeGone) onOpen(cook.recipeId); },
  },
    thumb(cook, 'ph'),
    el('div.grow',
      el('div', { text: cook.title, style: { fontWeight: '700', fontSize: '15px' } }),
      el('div.tiny.muted', {
        text: [
          showDate ? formatDate(cook.date, { weekday: true }) : null,
          `${cook.by} cooked`,
          cook.note,
        ].filter(Boolean).join(' · '),
      })),
    cook.recipeGone ? null : svg(ICONS.next, { size: 16 }));
}

/** The last two months of cooks, newest first, grouped by month. */
function timeline(onOpen) {
  const recent = state.cooks.slice(0, 40);
  if (!recent.length) return null;

  const wrap = el('div', el('div.section-title', { text: 'Recently' }));
  let lastMonth = null;

  for (const cook of recent) {
    const date = fromKey(cook.date);
    const label = `${monthName(date.getMonth())} ${date.getFullYear()}`;
    if (label !== lastMonth) {
      if (lastMonth !== null) wrap.append(el('div.timeline-month', { text: label }));
      lastMonth = label;
    }
    wrap.append(el('div', { style: { marginBottom: '8px' } }, cookEntry(cook, onOpen, { showDate: true })));
  }

  return wrap;
}

function stats() {
  const cooks = state.cooks;
  if (cooks.length < 3) return null;

  const last30 = cooks.filter((c) => c.date >= dateKey(new Date(Date.now() - 30 * 86400000)));
  const counts = new Map();
  for (const cook of cooks) counts.set(cook.title, (counts.get(cook.title) || 0) + 1);
  const [topTitle, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

  const byPerson = new Map();
  for (const cook of cooks) byPerson.set(cook.by, (byPerson.get(cook.by) || 0) + 1);

  return el('div',
    el('div.section-title', { text: 'Since you started' }),
    el('div.facts',
      el('div.fact', el('div.n', { text: String(cooks.length) }), el('div.l', { text: 'Meals' })),
      el('div.fact', el('div.n', { text: String(last30.length) }), el('div.l', { text: 'Last 30 days' })),
      el('div.fact', el('div.n', { text: String(counts.size) }), el('div.l', { text: 'Different' }))),
    topCount > 1
      ? el('p.tiny.muted', { style: { margin: '12px 2px 0', lineHeight: '1.5' } },
        `Most made: ${topTitle}, ${pluralise(topCount, 'time')}. `,
        [...byPerson.entries()].map(([who, n]) => `${who} cooked ${n}`).join(', ') + '.')
      : null,
    el('p.tiny.muted', { style: { margin: '8px 2px 0' }, text: `Last one: ${relativeDate(cooks[0].date)}.` }));
}
