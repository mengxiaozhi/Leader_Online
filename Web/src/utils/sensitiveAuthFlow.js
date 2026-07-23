export const SENSITIVE_AUTH_FLOW_EVENT = 'auth-sensitive-flow-complete'
export const SENSITIVE_AUTH_PENDING_KEY = 'leader_sensitive_auth_pending'

export const SENSITIVE_AUTH_TOKEN_KEYS = Object.freeze({
  registration: 'leader_registration_completion_token',
  reset: 'leader_password_reset_token',
})

const safeSessionStorage = () => {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage } catch { return null }
}

export const tokenStorageKey = (flow) => SENSITIVE_AUTH_TOKEN_KEYS[flow] || ''

export const saveSensitiveAuthToken = (flow, token, storage = safeSessionStorage()) => {
  const key = tokenStorageKey(flow)
  const value = String(token || '')
  if (!key || !storage || !value) return ''
  try {
    storage.setItem(key, value)
    storage.setItem(SENSITIVE_AUTH_PENDING_KEY, flow)
    return storage.getItem(key) === value ? value : ''
  } catch {
    return ''
  }
}

export const loadSensitiveAuthToken = (flow, storage = safeSessionStorage()) => {
  const key = tokenStorageKey(flow)
  if (!key || !storage) return ''
  try { return storage.getItem(key) || '' } catch { return '' }
}

export const clearSensitiveAuthFlow = (flow, storage = safeSessionStorage()) => {
  const key = tokenStorageKey(flow)
  if (!storage) return
  try {
    if (key) storage.removeItem(key)
    if (storage.getItem(SENSITIVE_AUTH_PENDING_KEY) === flow) {
      storage.removeItem(SENSITIVE_AUTH_PENDING_KEY)
    }
  } catch {}
}

export const readTokenFromHash = (hash, aliases = ['token']) => {
  const raw = String(hash || '').replace(/^#/, '')
  if (!raw) return ''
  const params = new URLSearchParams(raw)
  for (const alias of aliases) {
    const token = params.get(alias)
    if (token) return token
  }
  return ''
}

export const cleanSensitiveTokenUrl = (href, aliases = ['token']) => {
  const url = new URL(String(href || ''), 'https://local.invalid')
  for (const alias of aliases) url.searchParams.delete(alias)

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
  for (const alias of aliases) hashParams.delete(alias)
  const nextHash = hashParams.toString()
  url.hash = nextHash ? `#${nextHash}` : ''
  return `${url.pathname}${url.search}${url.hash}`
}

export const captureSensitiveAuthToken = ({
  flow,
  queryToken = '',
  hash = typeof window !== 'undefined' ? window.location.hash : '',
  href = typeof window !== 'undefined' ? window.location.href : '',
  aliases = ['token'],
  storage = safeSessionStorage(),
  history = typeof window !== 'undefined' ? window.history : null,
  title = typeof document !== 'undefined' ? document.title : '',
} = {}) => {
  const incoming = String(queryToken || readTokenFromHash(hash, aliases) || '')
  const persistedIncoming = incoming
    ? saveSensitiveAuthToken(flow, incoming, storage)
    : ''
  const token = incoming
    ? (persistedIncoming || incoming)
    : loadSensitiveAuthToken(flow, storage)

  if (persistedIncoming && history && href) {
    try { history.replaceState(null, title, cleanSensitiveTokenUrl(href, aliases)) } catch {}
  }
  return token
}

export const isSensitiveAuthPath = (pathname) => {
  const path = String(pathname || '').replace(/\/+$/, '') || '/'
  return path === '/reset' || path === '/register/complete'
}

export const hasPendingSensitiveAuthFlow = (storage = safeSessionStorage()) => {
  if (!storage) return false
  try {
    if (storage.getItem(SENSITIVE_AUTH_PENDING_KEY)) return true
    return Object.values(SENSITIVE_AUTH_TOKEN_KEYS).some((key) => Boolean(storage.getItem(key)))
  } catch {
    return false
  }
}

export const shouldDeferServiceWorkerReload = ({
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
  storage = safeSessionStorage(),
} = {}) => isSensitiveAuthPath(pathname) || hasPendingSensitiveAuthFlow(storage)

export const notifySensitiveAuthFlowComplete = ({
  flow,
  storage = safeSessionStorage(),
  target = typeof window !== 'undefined' ? window : null,
} = {}) => {
  clearSensitiveAuthFlow(flow, storage)
  if (!target?.dispatchEvent) return
  const EventType = typeof CustomEvent === 'function' ? CustomEvent : Event
  target.dispatchEvent(new EventType(SENSITIVE_AUTH_FLOW_EVENT, { detail: { flow } }))
}
