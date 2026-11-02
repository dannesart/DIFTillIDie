/*
 * Djurgår'n tills jag dör — a deliberately tiny service worker.
 *
 * It exists so the installed app behaves like an app, not to cache content:
 *  - Page navigations always go to the network (live news, fixtures, podcasts).
 *  - Only if the network fails do we show a static, honest offline page.
 *  - Everything else (API calls, audio streams, images, scripts) is not
 *    touched at all — the browser handles it as if there were no worker.
 * Nothing live is ever stored, so nothing stale can look current.
 */

const CACHE = 'djurgarn-shell-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove caches from older versions of this worker.
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    // Let navigations start fetching while the worker boots.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith((async () => {
    try {
      return (await event.preloadResponse) || (await fetch(event.request))
    }
    catch {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }
  })())
})
