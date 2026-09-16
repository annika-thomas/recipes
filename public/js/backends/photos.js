/**
 * Photos of the food, kept on the device.
 *
 * Not in localStorage: that's a ~5MB budget shared with every recipe you own,
 * and one phone photo would eat most of it. IndexedDB holds blobs properly and
 * gets a quota measured in hundreds of megabytes, so pictures live here and the
 * recipe JSON just keeps their ids.
 *
 * Everything is re-encoded to a sensible size on the way in — a modern phone
 * shoots 4MB images, and a picture of dinner does not need to be one. It also
 * quietly solves HEIC: Safari will decode it to a canvas happily, it just won't
 * hand the file over in a format anything else can read.
 */

const DB_NAME = 'kitchen-photos';
const STORE = 'photos';
const VERSION = 1;

const MAX_EDGE = 1400;
const QUALITY = 0.82;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error("This browser won't store photos."));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Couldn't open photo storage."));
    // Private browsing in Safari can leave the request hanging rather than
    // failing, so don't let a photo take the whole screen down with it.
    request.onblocked = () => reject(new Error('Photo storage is busy in another tab.'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

function transact(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Photo storage is full.'));
  }));
}

function newPhotoId() {
  return `ph_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Shrink and re-encode, so a recipe box doesn't fill a phone.
 * Falls back to the original file if the browser can't decode it for canvas.
 */
async function shrink(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (blob) return blob;
  } catch {
    // An old browser, or a format canvas won't take.
  }
  return file;
}

/** Store a picked file. Returns the id to put on the recipe or the cook. */
export async function putPhoto(file) {
  if (!file) throw new Error('No photo came through.');
  if (!/^image\//i.test(file.type || '')) throw new Error("That file isn't an image.");

  const blob = await shrink(file);
  const id = newPhotoId();

  try {
    await transact('readwrite', (store) => store.put(blob, id));
  } catch (err) {
    if (/quota|full/i.test(err?.name || err?.message || '')) {
      throw new Error("This device is out of space for photos. Delete a few, or remove some recipes.");
    }
    throw new Error("Couldn't save that photo on this device.");
  }
  return id;
}

/**
 * A URL for an <img src>. These are object URLs pointing at a blob in memory,
 * so they're cached per id and released together when the screen is torn down.
 */
const urls = new Map();

export async function photoUrl(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);

  try {
    const blob = await transact('readonly', (store) => store.get(id));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  } catch {
    return null;
  }
}

export async function deletePhoto(id) {
  if (!id) return;
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
  try {
    await transact('readwrite', (store) => store.delete(id));
  } catch { /* a photo that won't delete is not worth interrupting anyone over */ }
}

/** Every id currently stored — used to clean up photos nothing points at. */
export async function allPhotoIds() {
  try {
    return await transact('readonly', (store) => store.getAllKeys());
  } catch {
    return [];
  }
}

/**
 * Drop photos no recipe or cook refers to any more.
 * Deleting a recipe doesn't chase its picture at the time, because the delete
 * should be instant and a stray blob harms nothing until it accumulates.
 */
export async function collectGarbage(keepIds) {
  const keep = new Set(keepIds.filter(Boolean));
  const stored = await allPhotoIds();
  let removed = 0;

  for (const id of stored) {
    if (!keep.has(id)) {
      await deletePhoto(id);
      removed += 1;
    }
  }
  return removed;
}

/** Roughly how much room is left, for the Settings screen. */
export async function storageEstimate() {
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return null;
    return { usage, quota, percent: usage / quota };
  } catch {
    return null;
  }
}
