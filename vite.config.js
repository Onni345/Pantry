import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  /*
   * GitHub Pages serves a project site from a subpath —
   * https://<user>.github.io/<repo>/ — and every asset URL has to carry it or
   * the page loads and then 404s on its own JavaScript.
   *
   * It is read from the environment rather than hardcoded so the repo can be
   * renamed without editing this file, and so `npm run dev` stays at "/"
   * where it belongs. The Pages workflow derives it from GITHUB_REPOSITORY.
   */
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pantry',
        short_name: 'Pantry',
        description: 'Household food inventory',
        theme_color: '#17150f',
        background_color: '#17150f',
        display: 'standalone',
        // Relative, so it resolves against wherever the app is served from —
        // the root in development, /<repo>/ on Pages — without this file
        // needing to know which.
        start_url: '.',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],

        // The barcode decoder is a 1.1 MB WebAssembly module, and it is
        // deliberately NOT in the glob above. Precaching downloads it during
        // install for everyone — including Chrome and Android, where the
        // browser has its own BarcodeDetector and this file is never touched.
        // Caching it on first use instead costs those people nothing, and
        // costs an iPhone one download, after which scanning works offline
        // like everything else.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm',
              // Fingerprinted by Vite, so a given URL never changes content
              // and there is nothing to revalidate.
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});
