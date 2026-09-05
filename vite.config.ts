import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Vercel serves this as a static site with no server-side offline
      // support of its own — a service worker is the only thing that lets
      // the app boot with zero network at all (e.g. after "Install app"
      // from Chrome). This is separate from src/db/outbox.ts's offline
      // *data* sync, which already worked without this: that only kicks in
      // once the app has loaded, and until now the app itself couldn't
      // load offline in the first place.
      manifest: {
        name: 'KneeSense NER',
        short_name: 'KneeSense',
        description: 'Offline-first knee osteoarthritis screening for rural health workers',
        start_url: '.',
        display: 'standalone',
        background_color: '#fdfaf5',
        theme_color: '#2f8f7a',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Precache only the small app-shell files eagerly (installed
        // up front) — everything needed to boot the React app and open
        // the local database offline. sql.js's own wasm is ~650KB and
        // genuinely needed at boot, so it's precached too.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'assets/sql-wasm-*.wasm'],
        // The MediaPipe camera-cross-check assets (~40MB: three wasm
        // variants for different browser capabilities, plus the pose
        // model) are NOT precached — that would make every install
        // download 40MB up front for an optional feature most captures
        // don't even use. Instead they're cached the first time they're
        // actually fetched (i.e. the first time a health worker enables
        // the camera cross-check while online), and served from cache
        // offline after that. Until first use, the camera feature needs
        // connectivity once; the core screening flow never does.
        globIgnores: ['mediapipe/**'],
        runtimeCaching: [
          {
            urlPattern: /\/mediapipe\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe-assets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
