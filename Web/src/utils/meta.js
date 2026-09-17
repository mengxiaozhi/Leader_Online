import { buildPageMeta, metaEntries, serializeJsonLd, SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DEFAULT_IMAGE_ALT, DEFAULT_SITE_URL } from '../seo/metadata.js'

function setTag(selector, create, value, attribute) {
  const matches = [...document.head.querySelectorAll(selector)]
  let tag = matches.shift()
  matches.forEach(element => element.remove())
  if (value == null) { tag?.remove(); return }
  if (!tag) { tag = create(); document.head.appendChild(tag) }
  if (attribute) tag.setAttribute(attribute, String(value))
  else tag.textContent = value
}

export function setPageMeta(meta = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  // Async requests and KeepAlive pages must not overwrite the active page's head.
  if (meta.expectedPath && meta.expectedPath !== window.location.pathname) return
  const page = buildPageMeta(meta, window.location.pathname, import.meta.env?.VITE_SITE_URL || DEFAULT_SITE_URL)
  document.title = page.title
  for (const [attr, key, value] of metaEntries(page)) {
    setTag(`meta[${attr}="${key}"]`, () => {
      const tag = document.createElement('meta'); tag.setAttribute(attr, key); return tag
    }, value, 'content')
  }
  setTag('link[rel="canonical"]', () => {
    const tag = document.createElement('link'); tag.rel = 'canonical'; return tag
  }, page.url, 'href')
  setTag('#jsonld-page', () => {
    const tag = document.createElement('script'); tag.id = 'jsonld-page'; tag.type = 'application/ld+json'; return tag
  }, page.structuredData ? serializeJsonLd(page.structuredData) : null)
}

export const defaultMeta = { title: SITE_NAME, description: DEFAULT_DESCRIPTION, image: DEFAULT_IMAGE, imageAlt: DEFAULT_IMAGE_ALT }
export { SITE_NAME, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DEFAULT_IMAGE_ALT, DEFAULT_SITE_URL }
