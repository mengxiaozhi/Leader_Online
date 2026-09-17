import { publicPages, isPrivatePath } from './pages.js'

export const SITE_NAME = 'Leader Online'
export const DEFAULT_SITE_URL = 'https://spono.tw'
export const DEFAULT_DESCRIPTION = 'Leader Online 提供單車託運票券、賽事託運預約與運動課程選購，查看交車點、交取車時間及課程場次。'
export const DEFAULT_IMAGE = '/og_img.png'
export const DEFAULT_IMAGE_ALT = 'Leader Online 單車託運與運動課程平台'

export function siteOrigin(value = DEFAULT_SITE_URL) {
  const url = new URL(value || DEFAULT_SITE_URL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SITE_URL must be an HTTP(S) origin without a path, credentials, query or fragment')
  }
  return url.origin
}

export function canonicalUrl(path, origin = DEFAULT_SITE_URL) {
  const url = new URL(path || '/', siteOrigin(origin))
  let pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/') pathname = '/store'
  return `${siteOrigin(origin)}${pathname}`
}

function imageUrl(value, origin) {
  try {
    const url = new URL(value || DEFAULT_IMAGE, origin)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : new URL(DEFAULT_IMAGE, origin).href
  } catch { return new URL(DEFAULT_IMAGE, origin).href }
}

export function buildPageMeta(meta = {}, path = '/', origin = DEFAULT_SITE_URL) {
  origin = siteOrigin(origin)
  const pathname = new URL(path, origin).pathname.replace(/\/+$/, '') || '/'
  const page = { ...(publicPages[pathname] || {}), ...meta }
  const titleCore = String(page.title || '').trim()
  const title = titleCore && titleCore !== SITE_NAME ? `${titleCore}｜${SITE_NAME}` : `${SITE_NAME}｜單車託運與運動課程平台`
  const description = String(page.description || DEFAULT_DESCRIPTION).trim()
  const noindex = Boolean(page.noindex || isPrivatePath(pathname))
  const url = noindex ? null : canonicalUrl(page.url || pathname, origin)
  const image = imageUrl(page.image, origin)
  const defaultImage = image === imageUrl(DEFAULT_IMAGE, origin)
  // Uploaded covers have unknown dimensions; only report verified image metadata.
  const imageType = page.imageType || (defaultImage ? 'image/png' : null)
  const imageWidth = page.imageWidth || (defaultImage ? 1264 : null)
  const imageHeight = page.imageHeight || (defaultImage ? 842 : null)
  const imageAlt = page.imageAlt || DEFAULT_IMAGE_ALT
  const robots = noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'
  const structuredData = noindex || page.structuredData === false ? null : page.structuredData || {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE_NAME, url: origin, logo: `${origin}/logo.png` },
      { '@type': 'WebSite', '@id': `${origin}/#website`, name: SITE_NAME, url: origin, inLanguage: 'zh-Hant-TW', publisher: { '@id': `${origin}/#organization` } },
      { '@type': page.pageType || 'WebPage', '@id': `${url}#webpage`, name: title, url, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` }, primaryImageOfPage: { '@type': 'ImageObject', url: image } },
    ],
  }
  return { title, description, url, image, imageAlt, imageType, imageWidth, imageHeight, robots, structuredData, type: page.type || 'website' }
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const serializeJsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c')

export function metaEntries(page) {
  return [
    ['name', 'description', page.description], ['name', 'robots', page.robots],
    ['property', 'og:title', page.title], ['property', 'og:description', page.description],
    ['property', 'og:site_name', SITE_NAME], ['property', 'og:type', page.type], ['property', 'og:url', page.url],
    ['property', 'og:locale', 'zh_TW'], ['property', 'og:image', page.image], ['property', 'og:image:alt', page.imageAlt],
    ['property', 'og:image:type', page.imageType], ['property', 'og:image:width', page.imageWidth], ['property', 'og:image:height', page.imageHeight],
    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', page.title], ['name', 'twitter:description', page.description],
    ['name', 'twitter:image', page.image], ['name', 'twitter:image:alt', page.imageAlt],
  ]
}

export function renderPageHead(page) {
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    ...metaEntries(page).filter(([, , value]) => value != null).map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`),
    page.url ? `<link rel="canonical" href="${escapeHtml(page.url)}" />` : '',
    page.structuredData ? `<script id="jsonld-page" type="application/ld+json">${serializeJsonLd(page.structuredData)}</script>` : '',
  ].filter(Boolean).join('\n  ')
}
