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
    return `${y}/${m}/${d} ${hh}:${mm}`
}

export const formatDateTimeRange = (start, end, separator = ' ~ ') => {
    const formattedStart = formatDateTime(start, { fallback: '' })
    const formattedEnd = formatDateTime(end, { fallback: '' })
    if (formattedStart && formattedEnd) return `${formattedStart}${separator}${formattedEnd}`
    return formattedStart || formattedEnd
}

export const toDate = (input) => normalizeDateInput(input)

// API timestamps with an offset are instants; legacy SQL values without one
// represent Taiwan wall-clock time. Keep both independent of the viewer's zone.
export const formatTaipeiDateTime = (input, { fallback = '' } = {}) => {
    let value = input
    if (typeof value === 'string') {
        value = value.trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return normalizeDateInput(value) ? value.replace(/-/g, '/') : fallback
        }
        if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
            value = `${value.replace(' ', 'T')}+08:00`
        }
    }
    const date = normalizeDateInput(value)
    if (!date) return fallback
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
    const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    return `${fields.year}/${fields.month}/${fields.day} ${fields.hour}:${fields.minute}`
}
