import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built site works from any subpath (e.g. GitHub Pages).
  base: './',
  // App version shown in the header — always matches package.json.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
  ],
})
