/**
 * Asking the browser not to throw the recipe box away.
 *
 * By default a site's storage is "best effort", which means exactly what it
 * sounds like: Safari clears it for sites you haven't opened in about a week,
 * and every browser clears it first when the device runs low on space. For a
 * recipe box that is opened when you happen to cook, best effort is not good
 * enough — the gap between two roasts is longer than seven days.
 *
 * navigator.storage.persist() asks for the durable kind instead. Browsers
 * decide for themselves whether to grant it; an installed home-screen app is
 * the case they usually say yes to. It can only be asked from a page, not a
 * service worker, and asking twice is free, so this runs at every boot.
 *
 * Nothing here is allowed to break the app. If the API doesn't exist, or the
 * answer is no, the box still works — it is just evictable, and Settings says
 * so rather than letting you find out the hard way.
 */

/** What we last heard back, so Settings can report it without asking again. */
export const persistence = {
  supported: false,
  granted: false,
  asked: false,
};

/**
 * Ask for durable storage. Resolves to true if it was granted.
 *
 * Deliberately not awaited by boot: the answer changes nothing about what is
 * drawn, and on some browsers the prompt can take a moment.
 */
export async function requestPersistence() {
  const storage = navigator.storage;
  if (!storage?.persist || !storage?.persisted) return false;

  persistence.supported = true;

  try {
    // Already durable from a previous visit — don't ask again.
    if (await storage.persisted()) {
      persistence.granted = true;
      persistence.asked = true;
      return true;
    }

    persistence.granted = await storage.persist();
    persistence.asked = true;
    return persistence.granted;
  } catch {
    // Some browsers throw in private windows rather than returning false.
    persistence.asked = true;
    return false;
  }
}
