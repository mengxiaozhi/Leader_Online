const normalizeDateInput = (input) => {
    if (!input && input !== 0) return null
    if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? null : input
    }
    if (typeof input === 'number') {
        if (!Number.isFinite(input)) return null
        const fromNumber = new Date(input)
        return Number.isNaN(fromNumber.getTime()) ? null : fromNumber
    }
    const text = String(input).trim()
    if (!text) return null
    const direct = new Date(text)
    if (!Number.isNaN(direct.getTime())) return direct
    const normalized = new Date(text.replace(/-/g, '/'))
    if (!Number.isNaN(normalized.getTime())) return normalized
    return null
}

const pad2 = (value) => String(value).padStart(2, '0')

export const formatDateTime = (input, options = {}) => {
    const { fallback } = options
    const date = normalizeDateInput(input)
    if (!date) {
        if (Object.prototype.hasOwnProperty.call(options, 'fallback')) {
            return fallback
        }
        if (input === null || input === undefined) return ''
        return String(input)
    }
    const y = date.getFullYear()
    const m = pad2(date.getMonth() + 1)
    const d = pad2(date.getDate())
    const hh = pad2(date.getHours())
    const mm = pad2(date.getMinutes())
    return `${y}年${m}月${d}日 ${hh}時${mm}分鐘`
}

export const formatDateTimeRange = (start, end, separator = ' ~ ') => {
    const formattedStart = formatDateTime(start, { fallback: '' })
    const formattedEnd = formatDateTime(end, { fallback: '' })
    if (formattedStart && formattedEnd) return `${formattedStart}${separator}${formattedEnd}`
    return formattedStart || formattedEnd
}

export const toDate = (input) => normalizeDateInput(input)

