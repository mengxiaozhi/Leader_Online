const SITE_NAME = 'Leader Online'
const TITLE_SEPARATOR = '｜'
const DEFAULT_TAGLINE = '單車託運購票與預約平台'
const DEFAULT_DESCRIPTION = 'Leader Online 提供單車託運票券購買、服務檔期預約、交車點資訊與訂單管理的一站式服務。'
const DEFAULT_IMAGE = '/og_img.png'
const DEFAULT_IMAGE_ALT = 'Leader Online 單車託運購票與預約平台'
const DEFAULT_TYPE = 'website'
const DEFAULT_KEYWORDS = ['單車託運', '自行車託運', '貨車預約', '票券購買', '交車點', 'Leader Online']
const DEFAULT_SITE_URL = 'https://spono.tw'

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
const configuredSiteUrl = String(import.meta.env?.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '')

function siteOrigin() {
  if (configuredSiteUrl) return configuredSiteUrl
  if (isBrowser) return window.location.origin
  return DEFAULT_SITE_URL
}

function resolveUrl(path) {
  const base = siteOrigin()
  if (!path) {
    if (isBrowser) return `${base}${window.location.pathname}`
    return base
  }
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('//')) return `https:${path}`
  if (path.startsWith('/')) return `${base}${path}`
  return `${base}/${path.replace(/^\.\//, '')}`
}

function resolveCanonicalUrl(path) {
  if (!path && !isBrowser) return siteOrigin()
  const raw = path || (isBrowser ? window.location.pathname : '/')
  try {
    const url = new URL(raw, siteOrigin())
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '')
  } catch {
    return resolveUrl(raw)
  }
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
  const url = resolveCanonicalUrl(href)
  if (existing) existing.setAttribute('href', url)
  else {
    const link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', url)
    document.head.appendChild(link)
  }
}

function setJsonLd(id, value) {
  if (!isBrowser) return
  const elementId = `jsonld-${id}`
  let tag = document.getElementById(elementId)
  if (!value) {
    if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    return
  }
  if (!tag) {
    tag = document.createElement('script')
    tag.id = elementId
    tag.type = 'application/ld+json'
    document.head.appendChild(tag)
  }
  tag.textContent = JSON.stringify(value)
}

function buildBaseStructuredData(pageUrl, description, imageUrl) {
  const origin = siteOrigin()
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: origin,
      logo: resolveUrl('/logo.png'),
      image: imageUrl,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: origin,
      inLanguage: 'zh-Hant-TW',
      description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: document.title || `${SITE_NAME}${TITLE_SEPARATOR}${DEFAULT_TAGLINE}`,
      url: pageUrl,
      inLanguage: 'zh-Hant-TW',
      description,
      isPartOf: {
        '@type': 'WebSite',
        name: SITE_NAME,
        url: origin,
      },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: imageUrl,
      },
    },
  ]
}

export function setPageMeta(meta = {}) {
  if (!isBrowser) return
  const titleCore = meta.title ? String(meta.title).trim() : ''
  const fullTitle = titleCore && titleCore !== SITE_NAME
    ? `${titleCore}${TITLE_SEPARATOR}${SITE_NAME}`
    : `${SITE_NAME}${TITLE_SEPARATOR}${DEFAULT_TAGLINE}`
  document.title = fullTitle

  const description = meta.description ? String(meta.description).trim() : DEFAULT_DESCRIPTION
  const imageUrl = resolveUrl(meta.image || DEFAULT_IMAGE)
  const imageAlt = meta.imageAlt ? String(meta.imageAlt).trim() : DEFAULT_IMAGE_ALT
  const pageUrl = resolveCanonicalUrl(meta.url || window.location.pathname)
  const type = meta.type || DEFAULT_TYPE
  const keywordsSource = meta.keywords == null ? DEFAULT_KEYWORDS : meta.keywords
  const keywords = Array.isArray(keywordsSource) ? keywordsSource.filter(Boolean).join(', ') : (keywordsSource || '')
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
  setMetaAttr('property', 'og:image:alt', imageAlt)
  setMetaAttr('property', 'og:image:type', 'image/png')
  setMetaAttr('property', 'og:image:width', '1200')
  setMetaAttr('property', 'og:image:height', '630')
  setMetaAttr('property', 'og:locale', 'zh_TW')

  setMetaAttr('name', 'twitter:card', 'summary_large_image')
  setMetaAttr('name', 'twitter:title', fullTitle)
  setMetaAttr('name', 'twitter:description', description)
  setMetaAttr('name', 'twitter:image', imageUrl)
  setMetaAttr('name', 'twitter:image:alt', imageAlt)

  setCanonical(pageUrl)
  const structuredData = meta.structuredData === false
    ? null
    : (meta.structuredData || buildBaseStructuredData(pageUrl, description, imageUrl))
  setJsonLd('page', structuredData)
}

export const defaultMeta = {
  title: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
  image: DEFAULT_IMAGE,
  imageAlt: DEFAULT_IMAGE_ALT,
  type: DEFAULT_TYPE,
  keywords: DEFAULT_KEYWORDS,
}

export { SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DEFAULT_IMAGE_ALT, DEFAULT_SITE_URL }
