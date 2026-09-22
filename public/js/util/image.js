/**
 * Getting the pixels out of a picked file, and the crop rectangle onto them.
 *
 * Two things need to decode the same photo: the cropper, to show it to you,
 * and the photo store, to re-encode what you chose. Both go through here so
 * they can't disagree about how big the image is — which is the one thing that
 * would quietly move a crop off the part you picked.
 *
 * Crops travel as fractions of the image (0..1) rather than pixels for the
 * same reason. The cropper and the store each decode the file separately, and
 * a fraction means the same region whatever each of them measures.
 */

/**
 * Decode a File or Blob into something `drawImage` will take.
 *
 * `createImageBitmap` first, because it's off the main thread and because it's
 * the only thing that reads HEIC on iOS. The `<img>` fallback is for browsers
 * that don't have it — decoding is the part that varies between browsers, so
 * the fallback lives here rather than in every caller.
 *
 * Call `release()` when finished: a bitmap holds memory until it's closed, and
 * the fallback holds an object URL until it's revoked.
 */
export async function decodeImage(source) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      if (bitmap.width && bitmap.height) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          drawable: bitmap,
          release: () => bitmap.close?.(),
        };
      }
      bitmap.close?.();
    } catch {
      // An old browser, or a format this one won't decode off-thread.
    }
  }

  const url = URL.createObjectURL(source);
  const img = new Image();

  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("This browser couldn't read that image."));
      img.src = url;
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }

  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error("That image came through empty.");
  }

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    drawable: img,
    release: () => URL.revokeObjectURL(url),
  };
}

/** The whole picture, as a crop. */
export const WHOLE_IMAGE = { x: 0, y: 0, width: 1, height: 1 };

/**
 * A fractional crop as whole pixels inside a `width` x `height` image.
 *
 * Anything missing, upside down or off the edge comes back as the whole
 * image rather than as an error: a photo saved uncropped is a small
 * disappointment, and a photo not saved at all is losing the picture.
 */
export function cropBox(crop, width, height) {
  const whole = { x: 0, y: 0, width, height };
  if (!crop) return whole;

  const num = (value) => (Number.isFinite(value) ? value : null);
  const fx = num(crop.x);
  const fy = num(crop.y);
  const fw = num(crop.width);
  const fh = num(crop.height);
  if (fx === null || fy === null || !fw || !fh || fw <= 0 || fh <= 0) return whole;

  const x = Math.max(0, Math.min(width - 1, Math.round(fx * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(fy * height)));
  const w = Math.max(1, Math.min(width - x, Math.round(fw * width)));
  const h = Math.max(1, Math.min(height - y, Math.round(fh * height)));

  return { x, y, width: w, height: h };
}
