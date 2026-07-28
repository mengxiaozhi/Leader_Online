const toPositiveInteger = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

const MIME_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/heif', 'image/heic'],
])

const normalizeMimeType = (value) => {
  const normalized = String(value || '').trim().toLowerCase().split(';', 1)[0]
  return MIME_ALIASES.get(normalized) || normalized
}

export const normalizeChecklistPhotoPolicy = (raw = {}) => {
  const allowedMimeTypes = Array.isArray(raw?.allowedMimeTypes)
    ? [...new Set(raw.allowedMimeTypes.map(normalizeMimeType).filter(Boolean))]
    : []

  return {
    maxCount: toPositiveInteger(raw?.maxCount),
    maxBytes: toPositiveInteger(raw?.maxBytes),
    allowedMimeTypes,
  }
}

export const checklistPhotoAccept = (policy = {}) => (
  Array.isArray(policy.allowedMimeTypes)
    ? policy.allowedMimeTypes.map(normalizeMimeType).filter(Boolean).join(',')
    : ''
)

export const validateChecklistPhoto = (file, policy = {}) => {
  const maxBytes = toPositiveInteger(policy.maxBytes)
  const allowedMimeTypes = Array.isArray(policy.allowedMimeTypes)
    ? policy.allowedMimeTypes.map(normalizeMimeType).filter(Boolean)
    : []

  if (!file || !maxBytes || !allowedMimeTypes.length) {
    return { ok: false, code: 'POLICY_UNAVAILABLE' }
  }

  if (!allowedMimeTypes.includes(normalizeMimeType(file.type))) {
    return { ok: false, code: 'UNSUPPORTED_MIME' }
  }

  if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > maxBytes) {
    return { ok: false, code: 'FILE_TOO_LARGE' }
  }

  return { ok: true, code: '' }
}

const checklistPhotoCount = (reservation, stage) => {
  const stageInfo = reservation?.stageChecklist?.[stage]
  const checklist = reservation?.checklists?.[stage]
  const candidates = [
    stageInfo?.photoCount,
    checklist?.photoCount,
    Array.isArray(checklist?.photos) ? checklist.photos.length : 0,
  ]
  return candidates.reduce((count, value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > count ? parsed : count
  }, 0)
}

export const reservationChecklistDisplayStatus = (reservation = {}) => {
  const stage = String(reservation?.status || '').trim()
  if (stage === 'done') return '托運完成'

  const stageInfo = reservation?.stageChecklist?.[stage]
  const checklist = reservation?.checklists?.[stage]
  const photoCount = checklistPhotoCount(reservation, stage)
  const completed = Boolean(stageInfo?.completed || checklist?.completed)

  if (photoCount <= 0) return '待上傳照片'
  if (!completed) return '待完成檢核'
  return '檢核完成'
}

export const resolveReservationChecklistDeepLink = (query = {}) => {
  const hasReservation = Object.prototype.hasOwnProperty.call(query, 'reservation')
  const hasAction = Object.prototype.hasOwnProperty.call(query, 'action')
  const requested = hasReservation || hasAction
  if (!requested) return { requested: false, valid: false, reservationId: null }

  const rawReservation = typeof query.reservation === 'string' ? query.reservation.trim() : ''
  const action = typeof query.action === 'string' ? query.action.trim().toLowerCase() : ''
  const reservationId = /^\d+$/.test(rawReservation) ? toPositiveInteger(rawReservation) : 0

  return {
    requested: true,
    valid: action === 'checklist' && reservationId > 0,
    reservationId: reservationId || null,
  }
}
