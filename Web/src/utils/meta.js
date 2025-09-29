const SITE_NAME = 'Leader Online'
const TITLE_SEPARATOR = '｜'
const DEFAULT_DESCRIPTION = 'Leader Online 提供鐵人競賽票券購買、賽事預約與票券管理的一站式服務。'
const DEFAULT_IMAGE = '/logo.png'
const DEFAULT_TYPE = 'website'

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

function resolveUrl(path) {
  if (!isBrowser) return path || ''
  if (!path) return window.location.href
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('//')) return `${window.location.protocol}${path}`
  if (path.startsWith('/')) return `${window.location.origin}${path}`
  return `${window.location.origin}/${path.replace(/^\./, '')}`
}

function ensureMeta(attr, key) {
  if (!isBrowser) return null
  let tag = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  return tag
}

function setMetaAttr(attr, key, value) {
  if (!isBrowser) return
  const tag = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!value) {
    if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    return
  }
  const target = tag || ensureMeta(attr, key)
  if (target) target.setAttribute('content', value)
}

function setCanonical(href) {
  if (!isBrowser) return
  const existing = document.head.querySelector('link[rel="canonical"]')
  if (!href) {
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
    return
  }
  const url = resolveUrl(href)
  if (existing) existing.setAttribute('href', url)
  else {
    const link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', url)
    document.head.appendChild(link)
  }
}

export function setPageMeta(meta = {}) {
  if (!isBrowser) return
  const titleCore = meta.title ? String(meta.title).trim() : ''
  const fullTitle = titleCore ? `${titleCore}${TITLE_SEPARATOR}${SITE_NAME}` : `${SITE_NAME}${TITLE_SEPARATOR}鐵人競賽購票與預約平台`
  document.title = fullTitle

  const description = meta.description ? String(meta.description).trim() : DEFAULT_DESCRIPTION
  const imageUrl = resolveUrl(meta.image || DEFAULT_IMAGE)
  const pageUrl = meta.url ? resolveUrl(meta.url) : window.location.href
  const type = meta.type || DEFAULT_TYPE
  const keywords = Array.isArray(meta.keywords) ? meta.keywords.filter(Boolean).join(', ') : (meta.keywords || '')
  const robots = meta.noindex ? 'noindex, nofollow' : 'index, follow'

  setMetaAttr('name', 'description', description)
  setMetaAttr('name', 'keywords', keywords || null)
  setMetaAttr('name', 'robots', robots)

  setMetaAttr('property', 'og:title', fullTitle)
  setMetaAttr('property', 'og:description', description)
  setMetaAttr('property', 'og:site_name', SITE_NAME)
  setMetaAttr('property', 'og:type', type)
  setMetaAttr('property', 'og:url', pageUrl)
  setMetaAttr('property', 'og:image', imageUrl)

  setMetaAttr('name', 'twitter:card', 'summary_large_image')
  setMetaAttr('name', 'twitter:title', fullTitle)
  setMetaAttr('name', 'twitter:description', description)
  setMetaAttr('name', 'twitter:image', imageUrl)

  setCanonical(pageUrl)
}

export const defaultMeta = {
  title: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
  image: DEFAULT_IMAGE,
  type: DEFAULT_TYPE,
}

export { SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_IMAGE }
