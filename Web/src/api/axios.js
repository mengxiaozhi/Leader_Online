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

export default axios
