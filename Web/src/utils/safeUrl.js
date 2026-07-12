export const normalizeLocalPath = (value, fallback = '/store') => {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback
  try {
    const parsed = new URL(candidate, 'https://leader.local')
    if (parsed.origin !== 'https://leader.local') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export const normalizeHttpUrl = (value, fallback = '') => {
  const candidate = String(value || '').trim()
  if (!candidate) return fallback
  try {
    const parsed = new URL(candidate)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : fallback
  } catch {
    return fallback
  }
}
