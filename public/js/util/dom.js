/**
 * A hundred lines of DOM helper instead of a framework.
 *
 * The app is small enough that re-rendering a screen from scratch is both fast
 * enough and much easier to reason about than diffing. `el` builds nodes, and
 * each screen exports a function that returns one.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * el('div.card', { onclick }, 'text', childNode)
 * The tag accepts CSS-ish shorthand: 'button.btn.btn-primary'.
 */
export function el(spec, props = null, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline SVG from a path string — see ui/icons.js for the shapes. */
export function svg(paths, { size = 24, fill = false, width = 2 } = {}) {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('fill', fill ? 'currentColor' : 'none');
  if (!fill) {
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', width);
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  }
  node.setAttribute('aria-hidden', 'true');

  for (const d of [].concat(paths)) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    node.append(path);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function replace(node, ...children) {
  clear(node);
  return append(node, children);
}

/** Debounce for the search box — 120ms is under the threshold of feeling laggy. */
export function debounce(fn, ms = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
