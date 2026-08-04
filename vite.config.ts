import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `npm run build:standalone` — a single self-contained index.html a player
  // downloads and double-clicks, with no server and no internet access, ever.
  // vite-plugin-singlefile inlines the JS and CSS directly into the HTML text
  // instead of separate <script type="module">/<link> files, which sidesteps
  // the CORS restriction browsers apply to ES-module script fetches over
  // file:// (plain `npm run build`'s output only works served over http(s), e.g.
  // from `npm run preview` or real hosting — opening its index.html directly
  // fails for exactly that reason). PWA (service worker, installability) is
  // meaningless over file:// — service workers can't even register there — so
  // it's skipped entirely for this mode rather than shipping dead code.
  const standalone = mode === 'standalone'

  return {
    // Relative base so the built site works from any subpath (e.g. GitHub Pages)
    // — and, for the standalone build, from a bare file:// path too.
    base: './',
    // App version shown in the header — always matches package.json.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __PWA_ENABLED__: JSON.stringify(!standalone),
    },
    build: standalone
      ? {
          // Separate output dir so `npm run build` and `npm run build:standalone`
          // never clobber each other.
          outDir: 'dist-standalone',
          cssCodeSplit: false,
        }
      : undefined,
    plugins: [
      react(),
      ...(standalone
        ? [viteSingleFile()]
        : [
            VitePWA({
              registerType: 'autoUpdate',
              // We register the service worker ourselves (src/registerServiceWorker.ts)
              // with `updateViaCache: 'none'` so update checks always bypass the HTTP
              // cache — GitLab/GitHub Pages give no control over Cache-Control, and a
              // cached sw.js means the browser never notices a new deploy exists.
              injectRegister: false,
              includeAssets: ['ama-icon.png', 'ama-icon-192.png', 'apple-touch-icon.png'],
              manifest: {
                name: 'AMAnuensis — D&D Session Logs',
                short_name: 'AMA',
                description:
                  'Track D&D Adventurers League characters and session logs — offline, all data stays on your device.',
                theme_color: '#16121f',
                background_color: '#16121f',
                display: 'standalone',
                icons: [
                  {
                    src: 'ama-icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'ama-icon.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                ],
              },
            }),
          ]),
    ],
  }
})
