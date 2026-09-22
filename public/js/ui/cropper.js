/**
 * Choosing which part of a photo to keep.
 *
 * Phone cameras frame for the room, not for a recipe card, and the app shows
 * the result in two shapes it never asked about: a wide strip at the top of
 * the recipe and a small square in the list. Without a crop the app picks the
 * middle of the frame and hopes, which is how you end up with a recipe
 * illustrated by a tablecloth.
 *
 * So: the picture, a rectangle over it you can drag and resize, and a few
 * aspect ratios for the shapes the app actually uses. It resolves to a crop
 * in fractions of the image and stores nothing — re-encoding stays in
 * backends/photos.js, which is the only thing that writes a photo.
 *
 * The rectangle is kept in image pixels rather than screen pixels. Screen
 * pixels change when the sheet is resized or the phone is turned, and a crop
 * that drifts when you rotate the phone is worse than no crop at all.
 */

import { el, svg } from '../util/dom.js';
import { ICONS } from './icons.js';
import { openSheet } from './sheet.js';
import { decodeImage } from '../util/image.js';

/** The shapes the app displays a photo in, plus a free hand. */
const ASPECTS = [
  { id: 'free', label: 'Free', value: null },
  { id: 'wide', label: 'Recipe top', value: 16 / 9 },
  { id: 'card', label: '4:3', value: 4 / 3 },
  { id: 'square', label: 'Square', value: 1 },
];

const CORNERS = [
  { id: 'nw', label: 'Top left', x: 0, y: 0 },
  { id: 'ne', label: 'Top right', x: 1, y: 0 },
  { id: 'sw', label: 'Bottom left', x: 0, y: 1 },
  { id: 'se', label: 'Bottom right', x: 1, y: 1 },
];

/** How small the rectangle is allowed to get on screen, in CSS pixels. */
const MIN_ON_SCREEN = 56;

/** Tallest the picture is drawn, so the buttons under it stay in view. */
const maxStageHeight = () => Math.max(190, Math.min(Math.round(window.innerHeight * 0.44), 430));

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * openCropper({ source }) -> Promise<crop | null>
 *
 * `source` is the picked File, or the stored Blob when re-cropping. Resolves
 * to `{ x, y, width, height }` in fractions of the image, or null if it was
 * cancelled — including by the scrim, Escape, or a route change, since a sheet
 * closing for any reason means the crop wasn't chosen.
 */
export function openCropper({ source, title = 'Choose the part you want', confirmLabel = 'Use this' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    let teardown = null;

    const settle = (crop) => {
      if (answered) return;
      answered = true;
      resolve(crop);
    };

    const loading = el('p.tiny.muted', {
      text: 'Opening the photo…',
      style: { padding: '26px 0', textAlign: 'center' },
    });

    const sheet = openSheet({
      title,
      body: loading,
      onClose: () => {
        teardown?.();
        settle(null);
      },
    });

    decodeImage(source).then((image) => {
      if (answered) {
        image.release();
        return;
      }
      const view = buildCropper(image, {
        confirmLabel,
        onUse: (crop) => { settle(crop); sheet.close(); },
        onCancel: () => { settle(null); sheet.close(); },
      });
      teardown = view.teardown;
      sheet.setBody(view.body);
      sheet.setFooter(view.footer);
      view.mounted();
    }).catch((err) => {
      sheet.setBody(el('p.tiny', {
        text: err.message || "That photo couldn't be opened.",
        style: { color: 'var(--danger)', padding: '18px 0' },
      }));
      sheet.setFooter(el('button.btn.btn-ghost', {
        type: 'button', text: 'Close', onclick: () => sheet.close(),
      }));
    });
  });
}

/**
 * The cropper itself, over an already-decoded image.
 * Split out so the sheet plumbing above stays readable.
 */
function buildCropper(image, { confirmLabel, onUse, onCancel }) {
  const { width: iw, height: ih } = image;

  /* The rectangle, in image pixels. Starts as the whole picture: the common
     case is a photo that's already framed right, and a crop nobody touched
     should come out identical to no crop at all. */
  const crop = { x: 0, y: 0, w: iw, h: ih };
  let aspect = null;

  const canvas = el('canvas', { width: 1, height: 1 });
  const grid = el('div.crop-grid');
  const frame = el('div.crop-frame', {
    tabindex: '0',
    role: 'group',
    'aria-label': 'Crop area — arrow keys move it, shift and arrow keys resize it',
  }, grid);

  for (const corner of CORNERS) {
    frame.append(el(`span.crop-handle.crop-${corner.id}`, {
      'data-corner': corner.id,
      'aria-hidden': 'true',
    }));
  }

  const stage = el('div.crop-stage', canvas, frame);
  const readout = el('p.tiny.muted.crop-size', { 'aria-live': 'polite' });

  /* ------------------------------------------------------------- drawing --- */

  // Display size of the picture, in CSS pixels. Set by layout().
  let stageW = 0;
  let stageH = 0;

  function drawImageToCanvas() {
    if (!stageW || !stageH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.round(stageW * dpr);
    const pixelH = Math.round(stageH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, pixelW, pixelH);
    ctx.drawImage(image.drawable, 0, 0, iw, ih, 0, 0, pixelW, pixelH);
  }

  /** How wide the sheet is actually letting us be, padding taken off. */
  function roomForStage() {
    const wrap = stage.parentElement;
    if (!wrap || !wrap.clientWidth) return Math.max(120, stageW || 280);
    const style = getComputedStyle(wrap);
    const inner = wrap.clientWidth
      - (parseFloat(style.paddingLeft) || 0)
      - (parseFloat(style.paddingRight) || 0);
    return Math.max(120, Math.floor(inner));
  }

  /** Fit the picture into the space the sheet gives us, keeping its shape. */
  function layout() {
    const available = roomForStage();
    const maxH = maxStageHeight();

    let w = available;
    let h = Math.round((w * ih) / iw);
    if (h > maxH) {
      h = maxH;
      w = Math.round((h * iw) / ih);
    }

    stageW = w;
    stageH = h;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    drawImageToCanvas();
    paint();
  }

  /** Put the frame where the crop says, and say how big it'll come out. */
  function paint() {
    frame.style.left = `${(crop.x / iw) * 100}%`;
    frame.style.top = `${(crop.y / ih) * 100}%`;
    frame.style.width = `${(crop.w / iw) * 100}%`;
    frame.style.height = `${(crop.h / ih) * 100}%`;
    readout.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)} pixels`;
  }

  /* ------------------------------------------------- the rectangle's rules --- */

  /** Smallest the rectangle may get, in image pixels — MIN_ON_SCREEN on screen. */
  function minSize() {
    const perPixelX = stageW ? iw / stageW : 1;
    const perPixelY = stageH ? ih / stageH : 1;
    return {
      w: Math.min(iw, Math.max(8, MIN_ON_SCREEN * perPixelX)),
      h: Math.min(ih, Math.max(8, MIN_ON_SCREEN * perPixelY)),
    };
  }

  function moveTo(x, y) {
    crop.x = clamp(x, 0, iw - crop.w);
    crop.y = clamp(y, 0, ih - crop.h);
    paint();
  }

  /**
   * Resize by dragging `corner` to (x, y) in image pixels.
   *
   * The opposite corner is the one that stays put, which is what makes a
   * corner drag feel like grabbing the picture rather than nudging a box.
   */
  function resizeCorner(corner, start, x, y) {
    const spec = CORNERS.find((c) => c.id === corner);
    const min = minSize();

    // The edges that don't move, and which way the dragged one grows.
    const anchorX = spec.x ? start.x : start.x + start.w;
    const anchorY = spec.y ? start.y : start.y + start.h;
    const dirX = spec.x ? 1 : -1;
    const dirY = spec.y ? 1 : -1;

    const roomW = dirX > 0 ? iw - anchorX : anchorX;
    const roomH = dirY > 0 ? ih - anchorY : anchorY;
    if (roomW < 1 || roomH < 1) return;

    let w = clamp(dirX * (clamp(x, 0, iw) - anchorX), Math.min(min.w, roomW), roomW);
    let h = clamp(dirY * (clamp(y, 0, ih) - anchorY), Math.min(min.h, roomH), roomH);

    if (aspect) {
      // Follow whichever way the finger went further, then shrink to fit the
      // room left — otherwise a locked ratio can be dragged off the picture.
      if (w / aspect >= h) h = w / aspect;
      else w = h * aspect;

      const fit = Math.min(1, roomW / w, roomH / h);
      w *= fit;
      h *= fit;

      if (w < min.w || h < min.h) {
        const grow = Math.max(min.w / w, min.h / h);
        if (w * grow <= roomW && h * grow <= roomH) {
          w *= grow;
          h *= grow;
        }
      }
    }

    crop.w = w;
    crop.h = h;
    crop.x = dirX > 0 ? anchorX : anchorX - w;
    crop.y = dirY > 0 ? anchorY : anchorY - h;
    paint();
  }

  /**
   * Lock to an aspect ratio, keeping what's already selected as far as it can.
   *
   * Jumping to the biggest rectangle of the new shape would throw away the
   * region you'd just picked, so this keeps the current width, takes the
   * height from the ratio, and only shrinks if that won't fit.
   */
  function setAspect(value) {
    aspect = value;
    if (value) {
      const centreX = crop.x + crop.w / 2;
      const centreY = crop.y + crop.h / 2;
      const min = minSize();

      let w = Math.max(crop.w, min.w);
      let h = w / value;
      if (h > ih) { h = ih; w = h * value; }
      if (w > iw) { w = iw; h = w / value; }

      crop.w = w;
      crop.h = h;
      crop.x = clamp(centreX - w / 2, 0, iw - w);
      crop.y = clamp(centreY - h / 2, 0, ih - h);
    }
    paint();
    for (const [id, button] of aspectButtons) {
      button.setAttribute('aria-pressed', String(id === currentAspectId()));
    }
  }

  const currentAspectId = () => (ASPECTS.find((a) => a.value === aspect) || ASPECTS[0]).id;

  function reset() {
    aspect = null;
    crop.x = 0;
    crop.y = 0;
    crop.w = iw;
    crop.h = ih;
    setAspect(null);
  }

  /* -------------------------------------------------------------- dragging --- */

  // Pointer events rather than touch + mouse: one code path for a finger, a
  // trackpad and a stylus, and pointer capture keeps a drag alive when your
  // finger wanders off the picture mid-gesture.
  let drag = null;

  const toImage = (event) => {
    const box = stage.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / (box.width || 1)) * iw,
      y: ((event.clientY - box.top) / (box.height || 1)) * ih,
    };
  };

  /**
   * Begin a new rectangle out in bare picture, growing away from `anchor`.
   * Returns the corner now under the finger, so the same drag carries on as
   * an ordinary resize.
   */
  function startNewRect(anchor, toward) {
    const min = minSize();
    const w = Math.min(iw, aspect ? Math.max(min.w, min.h * aspect) : min.w);
    const h = Math.min(ih, aspect ? w / aspect : min.h);
    const east = toward.x >= anchor.x;
    const south = toward.y >= anchor.y;

    crop.w = w;
    crop.h = h;
    crop.x = clamp(east ? anchor.x : anchor.x - w, 0, Math.max(0, iw - w));
    crop.y = clamp(south ? anchor.y : anchor.y - h, 0, Math.max(0, ih - h));
    paint();

    return `${south ? 's' : 'n'}${east ? 'e' : 'w'}`;
  }

  const onPointerDown = (event) => {
    const handle = event.target.closest?.('.crop-handle');
    const onFrame = !!handle || frame.contains(event.target);

    drag = {
      id: event.pointerId,
      corner: handle?.dataset.corner || null,
      from: toImage(event),
      fromScreen: { x: event.clientX, y: event.clientY },
      start: { ...crop },
      // Dragging bare picture outside the frame starts a fresh rectangle
      // there, which beats dragging the old one across. A *tap* out there
      // does nothing, though: throwing away a rectangle you'd just lined up
      // because your thumb landed an inch off is not a feature.
      pendingNew: !onFrame,
    };

    frame.focus({ preventScroll: true });
    event.preventDefault();
    stage.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const point = toImage(event);

    if (drag.pendingNew) {
      const moved = Math.hypot(event.clientX - drag.fromScreen.x, event.clientY - drag.fromScreen.y);
      if (moved < 7) return;
      drag.corner = startNewRect(drag.from, point);
      drag.start = { ...crop };
      drag.pendingNew = false;
    }

    if (drag.corner) {
      resizeCorner(drag.corner, drag.start, point.x, point.y);
    } else {
      moveTo(drag.start.x + (point.x - drag.from.x), drag.start.y + (point.y - drag.from.y));
    }
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    stage.releasePointerCapture?.(event.pointerId);
    drag = null;
  };

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);

  /* Arrow keys, for cropping on a laptop. */
  frame.addEventListener('keydown', (event) => {
    const step = (event.shiftKey ? 0.04 : 0.012);
    const dx = { ArrowLeft: -1, ArrowRight: 1 }[event.key] || 0;
    const dy = { ArrowUp: -1, ArrowDown: 1 }[event.key] || 0;
    if (!dx && !dy) return;
    event.preventDefault();

    if (event.shiftKey) {
      // Resize from the bottom-right, which is where the eye expects it.
      resizeCorner('se', { ...crop }, crop.x + crop.w + dx * iw * step, crop.y + crop.h + dy * ih * step);
    } else {
      moveTo(crop.x + dx * iw * step, crop.y + dy * ih * step);
    }
  });

  /* ------------------------------------------------------------- controls --- */

  const aspectButtons = new Map();
  const aspectRow = el('div.chips.crop-aspects');

  for (const option of ASPECTS) {
    const button = el('button.chip', {
      type: 'button',
      text: option.label,
      'aria-pressed': String(option.value === aspect),
      onclick: () => setAspect(option.value),
    });
    aspectButtons.set(option.id, button);
    aspectRow.append(button);
  }

  const resetButton = el('button.btn.btn-ghost.crop-reset', {
    type: 'button', onclick: reset,
  }, svg(ICONS.refresh, { size: 15 }), 'Whole photo');

  /* -------------------------------------------------------------- mounting --- */

  const onResize = () => layout();

  const body = el('div.cropper',
    el('div.crop-stage-wrap', stage),
    el('div.crop-controls', aspectRow, el('div.row.crop-footnote', readout, resetButton)));

  reset();

  return {
    body,
    footer: [
      el('button.btn.btn-ghost', { type: 'button', text: 'Cancel', onclick: onCancel }),
      el('button.btn.btn-primary', {
        type: 'button',
        text: confirmLabel,
        onclick: () => onUse({
          x: crop.x / iw,
          y: crop.y / ih,
          width: crop.w / iw,
          height: crop.h / ih,
        }),
      }),
    ],
    /** Called once the body is in the document, when the width can be measured. */
    mounted: () => {
      layout();
      // The sheet animates up, so the first measurement can be mid-slide.
      requestAnimationFrame(layout);
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
    },
    teardown: () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      image.release();
    },
  };
}
