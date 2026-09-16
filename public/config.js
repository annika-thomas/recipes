/**
 * Where this copy of the app keeps its recipes.
 *
 *   'auto'   work it out by asking whether there's an API behind this page
 *   'local'  this device only — no server exists, don't bother asking
 *   'server' there is a server; talk to it
 *
 * Shipped as 'auto', which is right for the Worker and for `npm run dev`.
 *
 * github.io is special-cased rather than probed. Pages has no API behind it,
 * so the probe is a guaranteed failure, and on a slow phone connection the app
 * would sit blank waiting for a request that was never going to succeed. It's
 * decided here rather than rewritten by the publishing workflow so that every
 * way this repo gets published serves the identical file.
 */
window.KITCHEN_MODE = /(^|\.)github\.io$/i.test(location.hostname) ? 'local' : 'auto';
