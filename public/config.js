/**
 * Where this copy of the app keeps its recipes.
 *
 *   'auto'   work it out by asking whether there's an API behind this page
 *   'local'  this device only — no server exists, don't bother asking
 *   'server' there is a server; talk to it
 *
 * Shipped as 'auto', which is right for the Worker and for `npm run dev`. The
 * GitHub Pages workflow rewrites this file to 'local' before publishing, so the
 * app there doesn't spend a round trip on every open discovering an API that
 * was never going to be there.
 */
window.KITCHEN_MODE = 'auto';
