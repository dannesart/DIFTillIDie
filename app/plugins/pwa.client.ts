/*
 * Installability: detect the platform and catch the browser's install
 * prompt, and register the tiny network-first service worker (production
 * only — in development it would just get in the way).
 */
export default defineNuxtPlugin(() => {
  useInstall().init()

  if (!import.meta.dev && 'serviceWorker' in navigator) {
    const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
      console.warn('[pwa] service worker registration failed', e)
    })
    // Don't compete with the first page load; but the plugin may run after it.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }
})
