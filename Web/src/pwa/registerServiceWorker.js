import {
  hasPendingSensitiveAuthFlow,
  SENSITIVE_AUTH_FLOW_EVENT,
  shouldDeferServiceWorkerReload,
} from '../utils/sensitiveAuthFlow'

const SERVICE_WORKER_URL = '/sw.js'

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }).then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    }).catch((error) => {
      console.warn('[pwa] service worker registration failed', error)
    })

    let refreshing = false
    let refreshPending = false
    const reloadWhenSafe = ({ completedFlow = false } = {}) => {
      if (refreshing) return
      const mustDefer = completedFlow
        ? hasPendingSensitiveAuthFlow()
        : shouldDeferServiceWorkerReload()
      if (mustDefer) {
        refreshPending = true
        return
      }
      refreshing = true
      refreshPending = false
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      reloadWhenSafe()
    })

    window.addEventListener(SENSITIVE_AUTH_FLOW_EVENT, () => {
      if (!refreshPending) return
      window.setTimeout(() => reloadWhenSafe({ completedFlow: true }), 0)
    })
  })
}
