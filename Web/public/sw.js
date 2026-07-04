const CACHE_VERSION = 'leader-online-pwa-v1'
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const STATIC_CACHE = `${CACHE_VERSION}-static`
const NAVIGATION_CACHE = `${CACHE_VERSION}-navigation`

const PRECACHE_URLS = [
  '/',
  '/store',
  '/offline',
  '/manifest.webmanifest',
  '/icon.png',
  '/logo.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/maskable-icon-512.png',
  '/pwa/apple-touch-icon.png'
]

const SAME_ORIGIN_STATIC_EXTENSIONS = [
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.webp',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.webmanifest'
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE)
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const expectedCaches = new Set([APP_SHELL_CACHE, STATIC_CACHE, NAVIGATION_CACHE])
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((name) => expectedCaches.has(name) ? undefined : caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (!shouldHandleRequest(request)) return

  const url = new URL(request.url)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

function shouldHandleRequest(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  if (url.pathname === '/sw.js') return false
  if (url.pathname.startsWith('/api/')) return false
  return true
}

function isStaticAssetRequest(request, url) {
  if (['style', 'script', 'image', 'font', 'manifest'].includes(request.destination)) return true
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pwa/')) return true
  return SAME_ORIGIN_STATIC_EXTENSIONS.some((extension) => url.pathname.endsWith(extension))
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(NAVIGATION_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return (
      await caches.match(request) ||
      await caches.match('/offline') ||
      await caches.match('/') ||
      new Response('<!doctype html><title>Leader Online</title><main>目前離線，請稍後再試。</main>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    )
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone())
    return response
  }).catch(() => cached)
  return cached || network
}
