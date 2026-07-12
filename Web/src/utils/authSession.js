const BEARER_KEY = 'auth_bearer'
const USER_INFO_KEY = 'user_info'

const safeStorage = (name) => {
  if (typeof window === 'undefined') return null
  try { return window[name] } catch { return null }
}

const stripSecrets = (profile) => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  const { token, auth_token, access_token, jwt, ...safeProfile } = profile
  return safeProfile
}

export const getBearerToken = () => {
  const session = safeStorage('sessionStorage')
  const local = safeStorage('localStorage')
  const current = session?.getItem(BEARER_KEY) || ''
  if (current) return current

  // One-time migration from the previous persistent storage policy.
  const legacy = local?.getItem(BEARER_KEY) || ''
  if (legacy) {
    try { session?.setItem(BEARER_KEY, legacy) } catch {}
    try { local?.removeItem(BEARER_KEY) } catch {}
  }
  return legacy
}

export const setBearerToken = (token) => {
  const value = String(token || '').trim()
  const session = safeStorage('sessionStorage')
  const local = safeStorage('localStorage')
  try {
    if (value) session?.setItem(BEARER_KEY, value)
    else session?.removeItem(BEARER_KEY)
    local?.removeItem(BEARER_KEY)
  } catch {}
}

export const setUserProfile = (profile) => {
  const safeProfile = stripSecrets(profile)
  const local = safeStorage('localStorage')
  try {
    if (safeProfile) local?.setItem(USER_INFO_KEY, JSON.stringify(safeProfile))
    else local?.removeItem(USER_INFO_KEY)
  } catch {}
  return safeProfile
}

export const setAuthSession = (payload) => {
  const safeProfile = setUserProfile(payload)
  setBearerToken(payload?.token ?? payload?.access_token ?? '')
  return safeProfile
}

export const clearAuthSession = () => {
  const local = safeStorage('localStorage')
  const session = safeStorage('sessionStorage')
  try {
    local?.removeItem(USER_INFO_KEY)
    local?.removeItem(BEARER_KEY)
    session?.removeItem(BEARER_KEY)
  } catch {}
}
