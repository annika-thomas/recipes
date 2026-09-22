/**
 * The crop rectangle, turned into pixels.
 *
 * This is the piece between "which part of the photo you dragged a box around"
 * and "which pixels get saved", and it fails silently: a crop that's off by a
 * factor or flipped doesn't throw, it just stores the wrong half of the
 * picture, and by then the original file is gone. So the arithmetic gets tests
 * even though it's only twenty lines.
 *
 * `decodeImage` isn't tested here — it's canvas and object URLs, which need a
 * browser. It's exercised by hand against the real thing instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cropBox, WHOLE_IMAGE } from '../public/js/util/image.js';

test('a fractional crop becomes pixels', () => {
  assert.deepEqual(
    cropBox({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 1200, 800),
    { x: 300, y: 400, width: 600, height: 200 },
  );
});

test('the whole image is the whole image', () => {
  assert.deepEqual(cropBox(WHOLE_IMAGE, 1200, 800), { x: 0, y: 0, width: 1200, height: 800 });
  assert.deepEqual(cropBox(null, 640, 480), { x: 0, y: 0, width: 640, height: 480 });
});

test('a crop is rounded to whole pixels', () => {
  const box = cropBox({ x: 1 / 3, y: 1 / 3, width: 1 / 3, height: 1 / 3 }, 1000, 1000);
  assert.deepEqual(box, { x: 333, y: 333, width: 333, height: 333 });
});

/* --------------------------------------------- nonsense, which does happen --- */

test('a crop reaching past the edge is pulled back inside it', () => {
  const box = cropBox({ x: 0.8, y: 0.8, width: 0.5, height: 0.5 }, 1000, 500);
  assert.deepEqual(box, { x: 800, y: 400, width: 200, height: 100 });
});

test('a negative or zero-sized crop falls back to the whole image', () => {
  const whole = { x: 0, y: 0, width: 300, height: 200 };
  assert.deepEqual(cropBox({ x: -0.5, y: 0, width: 0, height: 1 }, 300, 200), whole);
  assert.deepEqual(cropBox({ x: 0, y: 0, width: -1, height: 1 }, 300, 200), whole);
  assert.deepEqual(cropBox({ x: 0, y: 0, width: NaN, height: 1 }, 300, 200), whole);
  assert.deepEqual(cropBox({ width: 1, height: 1 }, 300, 200), whole);
  assert.deepEqual(cropBox('nonsense', 300, 200), whole);
});

test('a crop off the left or top edge is clamped, not wrapped', () => {
  const box = cropBox({ x: -0.2, y: -0.2, width: 0.5, height: 0.5 }, 1000, 1000);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
  assert.ok(box.width > 0 && box.height > 0);
});
