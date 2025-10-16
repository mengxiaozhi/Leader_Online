// src/api/axios.js
import axios from 'axios'

// 跨站請求攜帶 Cookie（可用就用）
axios.defaults.withCredentials = true

// 全域攔截器：自動帶 Bearer（Safari/某些 WebView 會擋第三方 Cookie）
axios.interceptors.request.use((config) => {
    const t = localStorage.getItem('auth_bearer')
    if (t) config.headers.Authorization = `Bearer ${t}`
    return config
})

// 401 時自動清理本地狀態，避免殘留 Bearer 造成「假登入」
axios.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status
    if (status === 401) {
      try {
        localStorage.removeItem('user_info')
        localStorage.removeItem('auth_bearer')
        window.dispatchEvent(new Event('auth-changed'))
      } catch {}
    }
    return Promise.reject(error)
  }
)

export default axios
