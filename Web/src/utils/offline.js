const API_OFFLINE_FLAG_KEY = 'leader_api_offline_flag'
const API_OFFLINE_REDIRECT_KEY = 'leader_api_offline_redirect'

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const isApiOfflineFlagged = () => {
  const storage = getSessionStorage()
  if (!storage) return false
  return !!storage.getItem(API_OFFLINE_FLAG_KEY)
}

export const markApiOffline = (path = '') => {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.setItem(API_OFFLINE_FLAG_KEY, String(Date.now()))
    const fallback = (typeof window !== 'undefined' && window.location?.pathname) ? window.location.pathname : '/'
    const target = path && !path.startsWith('/offline') ? path : fallback
    if (target && target.startsWith('/')) storage.setItem(API_OFFLINE_REDIRECT_KEY, target)
  } catch {
    /* ignore */
  }
}

export const clearApiOffline = ({ keepRedirect = false } = {}) => {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.removeItem(API_OFFLINE_FLAG_KEY)
    if (!keepRedirect) storage.removeItem(API_OFFLINE_REDIRECT_KEY)
  } catch {
    /* ignore */
  }
}

export const consumeOfflineRedirect = () => {
  const storage = getSessionStorage()
  if (!storage) return '/'
  try {
    const target = storage.getItem(API_OFFLINE_REDIRECT_KEY)
    storage.removeItem(API_OFFLINE_REDIRECT_KEY)
    storage.removeItem(API_OFFLINE_FLAG_KEY)
    return (target && target.startsWith('/')) ? target : '/'
  } catch {
    return '/'
  }
}

export const getOfflineRedirectSnapshot = () => {
  const storage = getSessionStorage()
  if (!storage) return '/'
  try {
    const target = storage.getItem(API_OFFLINE_REDIRECT_KEY)
    return (target && target.startsWith('/')) ? target : '/'
  } catch {
    return '/'
  }
}

export const forceOfflinePage = () => {
  if (typeof window === 'undefined') return
  if (!window.location.pathname.startsWith('/offline')) {
    window.location.href = '/offline'
  }
}
