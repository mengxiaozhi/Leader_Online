// src/api/axios.js
import axios from 'axios'
import { markApiOffline, clearApiOffline, forceOfflinePage, isApiOfflineFlagged } from '../utils/offline'

// 跨站請求攜帶 Cookie（可用就用）
axios.defaults.withCredentials = true

// 全域攔截器：自動帶 Bearer（Safari/某些 WebView 會擋第三方 Cookie）
axios.interceptors.request.use((config) => {
    const t = localStorage.getItem('auth_bearer')
    if (t) config.headers.Authorization = `Bearer ${t}`
    return config
})

// 401 時自動清理本地狀態，避免殘留 Bearer 造成「假登入」
const shouldTriggerOffline = (error) => {
  if (!error) return false
  if (error?.config?.__skipOfflineHandling) return false
  const status = error?.response?.status
  if (status === 502 || status === 503 || status === 504) return true
  if (!error.response) {
    if (error?.code === 'ERR_NETWORK' || error?.code === 'ECONNABORTED') return true
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
    const message = (error?.message || '').toLowerCase()
    if (message.includes('network error') || message.includes('failed to fetch')) return true
  }
  return false
}

axios.interceptors.response.use(
  (resp) => {
    if (isApiOfflineFlagged()) clearApiOffline({ keepRedirect: true })
    return resp
  },
  (error) => {
    const status = error?.response?.status
    if (status === 401) {
      try {
        localStorage.removeItem('user_info')
        localStorage.removeItem('auth_bearer')
        window.dispatchEvent(new Event('auth-changed'))
      } catch {}
    }
    if (shouldTriggerOffline(error)) {
      try {
        const currentPath = (typeof window !== 'undefined')
          ? `${window.location.pathname}${window.location.search}`
          : '/'
        markApiOffline(currentPath || '/')
        forceOfflinePage()
      } catch {
        /* noop */
      }
    }
    return Promise.reject(error)
  }
)

export default axios
