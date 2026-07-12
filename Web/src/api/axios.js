// src/api/axios.js
import axios from 'axios'
import { clearApiOffline, isApiOfflineFlagged } from '../utils/offline'
import { clearAuthSession, getBearerToken } from '../utils/authSession'

// 跨站請求攜帶 Cookie（可用就用）
const client = axios.create({
  withCredentials: true,
  timeout: 20000
})

const RETRYABLE_METHODS = new Set(['get', 'head', 'options'])
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])
const MAX_RETRIES = 2
const DUPLICATE_REQUEST_MESSAGE = '資料處理中，請稍候'

let requestSerial = 0
let activeRequests = 0
let activeMutations = 0
const activityListeners = new Set()
const inflightMutations = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const compactString = (value) => {
  const text = String(value || '')
  if (text.length <= 2048) return text
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `[string:${text.length}:${(hash >>> 0).toString(16)}]`
}

const normalizeMethod = (config = {}) => String(config.method || 'get').toLowerCase()
const shouldTrackActivity = (config = {}) => {
  if (config.__skipActivity) return false
  return MUTATING_METHODS.has(normalizeMethod(config)) || config.__trackActivity === true
}

const getApiActivity = () => ({
  active: activeRequests > 0,
  pending: activeRequests,
  mutating: activeMutations > 0,
  mutations: activeMutations
})

const notifyApiActivity = () => {
  const state = getApiActivity()
  activityListeners.forEach((listener) => {
    try { listener(state) } catch {}
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('leader-api-activity', { detail: state }))
  }
}

export const subscribeApiActivity = (listener) => {
  if (typeof listener !== 'function') return () => {}
  activityListeners.add(listener)
  listener(getApiActivity())
  return () => activityListeners.delete(listener)
}

export { getApiActivity }

const beginApiActivity = (config = {}) => {
  if (!shouldTrackActivity(config)) return null
  const id = `api-${++requestSerial}`
  activeRequests += 1
  if (MUTATING_METHODS.has(normalizeMethod(config))) activeMutations += 1
  notifyApiActivity()
  return id
}

const endApiActivity = (config = {}) => {
  if (!config?.__activityId || config.__activityEnded) return
  config.__activityEnded = true
  activeRequests = Math.max(0, activeRequests - 1)
  if (config.__activityIsMutation) activeMutations = Math.max(0, activeMutations - 1)
  notifyApiActivity()
}

const stableStringify = (value, seen = new WeakSet()) => {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return compactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return value.toString()
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const entries = []
    value.forEach((entryValue, key) => {
      if (entryValue && typeof entryValue === 'object' && 'name' in entryValue && 'size' in entryValue) {
        entries.push([key, `${entryValue.name}:${entryValue.size}`])
      } else {
        entries.push([key, String(entryValue)])
      }
    })
    return stableStringify(entries)
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `blob:${value.type}:${value.size}`
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item, seen)).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${key}:${stableStringify(value[key], seen)}`).join(',')}}`
}

const requestUrl = (config = {}) => {
  const url = String(config.url || '')
  if (!config.baseURL) return url
  try {
    return new URL(url, config.baseURL).href
  } catch {
    return `${config.baseURL || ''}${url}`
  }
}

const buildMutationKey = (config = {}) => {
  return [
    normalizeMethod(config),
    requestUrl(config),
    stableStringify(config.params),
    stableStringify(config.data)
  ].join('|')
}

const createDuplicateRequestError = (config = {}) => {
  const error = new axios.CanceledError(DUPLICATE_REQUEST_MESSAGE, config)
  error.code = 'ERR_DUPLICATE_REQUEST'
  error.config = config
  error.__duplicateRequest = true
  return error
}

export const isDuplicateRequest = (error) => {
  return Boolean(error?.__duplicateRequest || error?.code === 'ERR_DUPLICATE_REQUEST')
}

const shouldRetry = (error) => {
  if (!error) return false
  const config = error.config || {}
  if (config.__skipRetry) return false
  const method = String(config.method || 'get').toLowerCase()
  if (!RETRYABLE_METHODS.has(method)) return false
  const retried = Number(config.__retryCount || 0)
  if (retried >= MAX_RETRIES) return false
  const status = error?.response?.status
  if (!error.response) {
    return error?.code === 'ERR_NETWORK' || error?.code === 'ECONNABORTED'
  }
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

// 全域攔截器：自動帶 Bearer（Safari/某些 WebView 會擋第三方 Cookie）
client.interceptors.request.use((config) => {
    const t = getBearerToken()
    if (t) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${t}`
    }
    if (!config.__activityId) {
      config.__activityIsMutation = MUTATING_METHODS.has(normalizeMethod(config))
      config.__activityId = beginApiActivity(config)
    }
    return config
})

client.interceptors.response.use(
  (resp) => {
    endApiActivity(resp.config)
    if (isApiOfflineFlagged()) clearApiOffline({ keepRedirect: true })
    return resp
  },
  (error) => {
    if (shouldRetry(error)) {
      const config = error.config || {}
      const nextRetry = Number(config.__retryCount || 0) + 1
      config.__retryCount = nextRetry
      const delay = 250 * (2 ** (nextRetry - 1))
      return sleep(delay).then(() => client.request(config))
    }
    endApiActivity(error.config)
    const status = error?.response?.status
    if (status === 401) {
      try {
        clearAuthSession()
        window.dispatchEvent(new Event('auth-changed'))
      } catch {}
    }
    return Promise.reject(error)
  }
)

const guardedRequest = (config = {}) => {
  const method = normalizeMethod(config)
  if (!MUTATING_METHODS.has(method) || config.__skipDuplicateGuard) {
    return client.request(config)
  }
  const key = config.__dedupeKey || buildMutationKey(config)
  if (inflightMutations.has(key)) {
    return Promise.reject(createDuplicateRequestError(config))
  }
  const promise = client.request(config).finally(() => {
    if (inflightMutations.get(key) === promise) inflightMutations.delete(key)
  })
  inflightMutations.set(key, promise)
  return promise
}

const request = (configOrUrl, config = {}) => {
  if (typeof configOrUrl === 'string') {
    return guardedRequest({ ...config, url: configOrUrl })
  }
  return guardedRequest({ ...(configOrUrl || {}) })
}

const methodWithoutData = (method) => (url, config = {}) => guardedRequest({ ...config, method, url })
const methodWithData = (method) => (url, data, config = {}) => guardedRequest({ ...config, method, url, data })

const api = {
  request,
  get: methodWithoutData('get'),
  delete: methodWithoutData('delete'),
  head: methodWithoutData('head'),
  options: methodWithoutData('options'),
  post: methodWithData('post'),
  put: methodWithData('put'),
  patch: methodWithData('patch'),
  defaults: client.defaults,
  interceptors: client.interceptors,
  getUri: client.getUri.bind(client)
}

export default api
