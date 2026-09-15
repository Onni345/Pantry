import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Set this to '/<repo-name>/' if deploying to GitHub Pages under a subpath.
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pantry',
        short_name: 'Pantry',
        description: 'Household food inventory',
        theme_color: '#1f1f1f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
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
