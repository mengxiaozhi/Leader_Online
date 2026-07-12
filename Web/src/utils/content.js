const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i
const ALLOWED_TAGS = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'EM', 'H1', 'H2', 'H3', 'H4', 'HR', 'I', 'LI', 'OL', 'P', 'SPAN', 'STRONG', 'U', 'UL'])
const DROP_CONTENT_TAGS = new Set(['EMBED', 'FORM', 'IFRAME', 'MATH', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE'])

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeRichText(raw) {
  if (raw == null) return ''
  const value = String(raw).trim()
  if (!value) return ''
  if (HTML_TAG_PATTERN.test(value)) return sanitizeRichHtml(value)

  const paragraphs = []
  let buffer = []

  value.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      if (buffer.length) {
        paragraphs.push(buffer.join('<br />'))
        buffer = []
      }
      return
    }
    buffer.push(escapeHtml(line))
  })

  if (buffer.length) {
    paragraphs.push(buffer.join('<br />'))
  }

  return paragraphs.length
    ? paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')
    : ''
}

export function sanitizeRichHtml(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (typeof DOMParser === 'undefined') return `<p>${escapeHtml(value)}</p>`

  const document = new DOMParser().parseFromString(value, 'text/html')
  const elements = Array.from(document.body.querySelectorAll('*'))
  for (const element of elements) {
    if (DROP_CONTENT_TAGS.has(element.tagName)) {
      element.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes)
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const allowed = element.tagName === 'A' && ['href', 'rel', 'target', 'title'].includes(name)
      if (!allowed) element.removeAttribute(attribute.name)
    }

    if (element.tagName === 'A') {
      const href = String(element.getAttribute('href') || '').trim()
      let safeHref = ''
      try {
        const parsed = new URL(href, window.location.origin)
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) safeHref = parsed.href
      } catch {}
      if (!safeHref) element.removeAttribute('href')
      else element.setAttribute('href', safeHref)
      if (element.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer')
      } else {
        element.removeAttribute('target')
        element.removeAttribute('rel')
      }
    }
  }
  return document.body.innerHTML
}

export function extractPlainText(raw) {
  if (raw == null) return ''
  return String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function summarizeText(raw, maxLength = 160) {
  const text = extractPlainText(raw)
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trim()}…`
}
