/**
 * The sandbox origin's service worker.
 *
 * Its whole job is to make the Python runtime survive a bad connection. The
 * core -- wasm, standard library, loader -- is cached the first time it is
 * fetched, and package wheels the first time a program imports them. A machine
 * that has booted once then boots again with no network at all, which is what
 * a school on a filtered or intermittent connection actually needs.
 *
 * Only immutable, versioned assets are cached. HTML and application code are
 * never touched, so a deployment is picked up on the next load like any other
 * site; the runtime is versioned by its path, so a new Pyodide is a new cache.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'fledge-runtime-v1';
const CDN = 'https://cdn.jsdelivr.net/pyodide/';

/**
 * Fetched at install, not merely observed. On the very first visit the runtime
 * is requested before this worker has finished registering, so a worker that
 * only caches what passes through it sees turtle.py -- fetched after boot -- and
 * nothing else, and the second boot fails. The core is a fixed, short list;
 * the browser's own HTTP cache makes fetching it again here nearly free.
 */
const CORE = [
  '/pyodide/pyodide.mjs',
  '/pyodide/pyodide.asm.mjs',
  '/pyodide/pyodide.asm.wasm',
  '/pyodide/python_stdlib.zip',
  '/pyodide/pyodide-lock.json',
  '/python/turtle.py',
];

function cacheable(url: URL): boolean {
  if (url.origin === sw.location.origin) {
    return url.pathname.startsWith('/pyodide/') || url.pathname.startsWith('/python/');
  }
  // Package wheels from the default package base. Anything else is not ours.
  return url.href.startsWith(CDN);
}

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic: one missing file and none are kept, which is the
    // behaviour we want -- a partial core is a runtime that will not boot.
    await cache.addAll(CORE);
    await sw.skipWaiting();
  })());
});
sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches from earlier versions of this worker.
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !cacheable(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    // Cache first: these files are immutable by their path, so a hit is never
    // stale, and answering from cache is what makes offline work at all.
    if (hit) return hit;
    const response = await fetch(event.request);
    // Opaque responses cannot be inspected, and a cached failure would be a
    // permanent one. Only a good, readable response is worth keeping.
    if (response.ok && response.type !== 'opaque') void cache.put(event.request, response.clone());
    return response;
  })());
});
