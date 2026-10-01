export const handoverStages = [
  { key: 'pre_dropoff', label: '賽前交車' },
  { key: 'pre_pickup', label: '賽前取車' },
  { key: 'post_dropoff', label: '賽後交車' },
  { key: 'post_pickup', label: '賽後取車' },
]

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
