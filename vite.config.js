import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'Travel Planner · Viajes Estratégicos',
        short_name: 'Viajes',
        description: 'Planificador estratégico de viajes: encuentra el mejor alojamiento según los lugares que quieres visitar.',
        theme_color: '#256af4',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'es',
        icons: [
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-shell precache. NO cacheamos peticiones de Google Maps ni de la
        // API de Supabase (datos en vivo): solo fuentes/estáticos por red-primero.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Excluir explícitamente Maps y Supabase del manejo del service worker.
        navigateFallbackDenylist: [/^\/api/, /maps\.googleapis\.com/, /supabase\.co/],
      },
    }),
  ],
})
