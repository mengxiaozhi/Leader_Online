export const handoverStages = [
  { key: 'pre_dropoff', label: '賽前交車' },
  { key: 'pre_pickup', label: '賽前取車' },
  { key: 'post_dropoff', label: '賽後交車' },
  { key: 'post_pickup', label: '賽後取車' },
]

export const handoverLocationStages = ['pre_pickup', 'post_dropoff']

export function handoverLocationsDraft(schedule) {
  return Object.fromEntries(handoverLocationStages.map(stage => [stage, schedule?.locations?.[stage] || '']))
}

export function handoverLocationsPayload(draft) {
  return Object.fromEntries(handoverLocationStages.map(stage => {
    const value = draft?.[stage]
    const label = handoverStages.find(item => item.key === stage).label
    if (value !== null && typeof value !== 'string') throw new Error(`${label}地點格式不正確`)
    const normalized = (value || '').trim()
    if (normalized.length > 255) throw new Error(`${label}地點最多 255 字`)
    return [stage, normalized || null]
  }))
}

export function handoverLocation(schedule, stage, storeName = '', storeAddress = '') {
  if (handoverLocationStages.includes(stage)) {
    const location = schedule?.locations?.[stage]
    return typeof location === 'string' && location.trim() ? location.trim() : '地點待公布'
  }
  if (['pre_dropoff', 'post_pickup'].includes(stage)) {
    return [storeName, storeAddress].map(value => String(value || '').trim()).filter(Boolean).join('／') || '地點待公布'
  }
  return '地點待公布'
}

export function reservationHandoverLocation(record = {}, stage = record.status) {
  return handoverLocation(record.handoverSchedule, stage === 'pickup' ? 'pre_pickup' : stage,
    record.store || '', record.store_address || record.storeAddress || '')
}

export function reservationHandoverRoute(record = {}) {
  const store = { name: record.store || '', address: record.store_address || record.storeAddress || '' }
  const isReturn = ['post_dropoff', 'post_pickup', 'done'].includes(record.status)
  const onsite = { name: record.event || '', address: reservationHandoverLocation(record, isReturn ? 'post_dropoff' : 'pre_pickup') }
  return isReturn ? { origin: onsite, destination: store } : { origin: store, destination: onsite }
}

export function handoverTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return parts.replace(' ', 'T')
}

export function handoverWindow(window) {
  if (!window) return '時間待公布'
  return `${handoverTime(window.startsAt).replace('T', ' ')} ～ ${handoverTime(window.endsAt).replace('T', ' ')}`
}

export function reservationDropoffLockReason(reservation, now = Date.now()) {
  const stage = reservation?.status
  if (!['pre_dropoff', 'post_dropoff'].includes(stage)) return ''
  const schedule = reservation.handoverSchedule
  if (schedule?.available === false) return '交車時程暫時無法載入，請稍後再試'
  const window = schedule?.stages?.[stage]
  const startsAt = window?.startsAt ? new Date(window.startsAt).getTime() : NaN
  const endsAt = window?.endsAt ? new Date(window.endsAt).getTime() : NaN
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    return '交車時間尚未公布，暫時無法交車'
  }
  if (now < startsAt) return `尚未到交車時間，${handoverTime(window.startsAt).replace('T', ' ')} 起開放`
  return ''
}

export function handoverDraft(schedule) {
  return Object.fromEntries(handoverStages.map(({ key }) => [key, {
    startsAt: handoverTime(schedule?.stages?.[key]?.startsAt),
    endsAt: handoverTime(schedule?.stages?.[key]?.endsAt),
  }]))
}

export function handoverPayload(draft) {
  return Object.fromEntries(handoverStages.map(({ key, label }) => {
    const window = draft[key] || {}
    if (!window.startsAt && !window.endsAt) return [key, null]
    if (!window.startsAt || !window.endsAt) throw new Error(`${label}請完整填寫開始與結束時間`)
    const startsAt = `${window.startsAt}+08:00`
    const endsAt = `${window.endsAt}+08:00`
    if (!Number.isFinite(new Date(startsAt).getTime()) || !Number.isFinite(new Date(endsAt).getTime()) || new Date(endsAt) <= new Date(startsAt)) throw new Error(`${label}結束時間必須晚於開始時間`)
    return [key, { startsAt, endsAt }]
  }))
}

export const maxHandoverReminders = 5
export const handoverReminderUnits = [
  { value: 1440, label: '天' }, { value: 60, label: '小時' }, { value: 1, label: '分鐘' },
]

export function handoverReminderEntry(minutes) {
  const unit = minutes > 1440 && minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1
  return { value: minutes / unit, unit }
}

export function handoverReminderDraft(settings) {
  return Object.fromEntries(handoverStages.map(({ key }) => [key, (settings?.[key] ?? [1440]).map(handoverReminderEntry)]))
}

function reminderMinutes(entry) {
  const value = Number(entry?.value), unit = Number(entry?.unit)
  if (!Number.isSafeInteger(value) || value < 1 || !handoverReminderUnits.some(option => option.value === unit)) return null
  const minutes = value * unit
  return Number.isSafeInteger(minutes) && minutes <= 43200 ? minutes : null
}

export function handoverReminderPayload(draft) {
  return Object.fromEntries(handoverStages.map(({ key, label }) => {
    const rows = draft[key]
    if (!Array.isArray(rows) || rows.length > maxHandoverReminders) throw new Error(`${label}最多設定 ${maxHandoverReminders} 次提醒`)
    const values = rows.map(reminderMinutes)
    if (values.includes(null)) throw new Error(`${label}請填寫提前 1 分鐘至 30 天的整數提醒時間`)
    if (new Set(values).size !== values.length) throw new Error(`${label}的提醒時間不可重複`)
    return [key, values.sort((a, b) => b - a)]
  }))
}

export function handoverReminderLabel(minutes) {
  const entry = handoverReminderEntry(minutes)
  return `提前 ${entry.value} ${handoverReminderUnits.find(unit => unit.value === entry.unit).label}`
}

export function handoverReminderAt(startsAt, entry) {
  const minutes = reminderMinutes(entry)
  if (!startsAt || minutes == null) return ''
  const start = new Date(startsAt.endsWith('+08:00') ? startsAt : `${startsAt}+08:00`).getTime()
  return Number.isFinite(start) ? handoverTime(new Date(start - minutes * 60000).toISOString()).replace('T', ' ') : ''
}
