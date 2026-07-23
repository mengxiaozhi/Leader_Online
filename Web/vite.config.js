import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Sitemap from 'vite-plugin-sitemap'

const siteUrl = (process.env.VITE_SITE_URL || 'https://spono.tw').replace(/\/+$/, '')
const publicRoutes = [
  '/store',
  '/terms',
  '/provider-terms',
  '/privacy',
  '/reservation-notice',
  '/reservation-rules',
]
const excludedRoutes = ['/', '/admin', '/account', '/wallet', '/login', '/reset', '/register/complete', '/offline', '/404']

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Sitemap({
      hostname: siteUrl,
      dynamicRoutes: publicRoutes,
      exclude: excludedRoutes,
      readable: true,
      changefreq: {
        '*': 'monthly',
        '/store': 'daily',
      },
      priority: {
        '*': 0.5,
        '/store': 1,
        '/reservation-notice': 0.6,
        '/reservation-rules': 0.6,
      },
      generateRobotsTxt: true,
      robots: [
        {
          userAgent: '*',
          allow: '/',
          disallow: excludedRoutes.filter(route => route !== '/'),
        },
      ],
    }),
  ],
})
