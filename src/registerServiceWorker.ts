// Custom service-worker registration (vite-plugin-pwa's own injected script was
// dropped via `injectRegister: false` in vite.config.ts).
//
// Why this exists: GitLab/GitHub Pages give no way to set Cache-Control headers.
// If sw.js gets cached by the browser like any other .js file, the browser never
// re-fetches it to notice a new deploy — every "autoUpdate" config in the world
// can't help, because the update check itself never reaches the network. Only a
// hard refresh (which bypasses HTTP cache entirely) would ever reveal the update.
//
// `updateViaCache: 'none'` fixes this at the registration level: it tells the
// browser to always bypass HTTP cache when fetching sw.js, on every check —
// automatic (once per navigation) or the manual ones triggered below — regardless
// of whatever caching headers the host sends.
import { Workbox } from 'workbox-window'

export function registerServiceWorker() {
  if (!__PWA_ENABLED__ || import.meta.env.DEV || !('serviceWorker' in navigator)) {
    return
  }

  const wb = new Workbox(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })

  // Reload once the NEW worker is in charge of this page ('controlling' fires
  // after it claims us, so the reload is guaranteed to be served the new build —
  // 'activated' can fire before the claim). Guarded: a reload must happen once.
  let reloading = false
  wb.addEventListener('controlling', (event) => {
    if ((event.isUpdate || event.isExternal) && !reloading) {
      reloading = true
      window.location.reload()
    }
  })

  // Belt and braces: if a new worker ever ends up waiting anyway (e.g. a build
  // without skipWaiting, or another tab holding the old one), tell it to take
  // over instead of sitting there until every tab is closed.
  wb.addEventListener('waiting', () => {
    void wb.messageSkipWaiting()
  })

  wb.register()

  // Long-lived tabs (a character sheet left open) don't naturally trigger a new
  // navigation, so also check whenever the tab regains focus, plus a periodic
  // safety net for tabs that are never backgrounded.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wb.update()
  })
  setInterval(() => wb.update(), 60 * 60 * 1000)
}
