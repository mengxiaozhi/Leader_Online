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
