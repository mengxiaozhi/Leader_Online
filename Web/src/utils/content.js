const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

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
  if (HTML_TAG_PATTERN.test(value)) return value

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
