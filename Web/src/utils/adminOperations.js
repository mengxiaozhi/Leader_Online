export const reservationStageLabels = Object.freeze({
  service_booking: '待開始',
  pre_dropoff: '待賽前交車',
  pre_pickup: '待賽前取車',
  post_dropoff: '待賽後交車',
  post_pickup: '待賽後取車',
  done: '已完成',
  cancelled: '已取消',
})

// A missing summary is unavailable, not a zero count.
export function readSummaryCount(summary, key = 'total') {
  const raw = key === 'total' ? summary?.total : (summary?.byStatus?.[key] ?? summary?.[key])
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

// This describes the returned recent records, never the complete reservation set.
export function groupRecentReservationStores(records = []) {
  const groups = new Map()
  const seen = new Set()
  for (const record of records) {
    if (record.id != null) {
      const id = String(record.id)
      if (seen.has(id)) continue
      seen.add(id)
    }
    const name = String(record.store || '').trim() || '交車點待確認'
    if (!groups.has(name)) groups.set(name, { name, total: 0, dropoff: 0, pickup: 0, done: 0, other: 0 })
    const group = groups.get(name)
    group.total += 1
    if (['pre_dropoff', 'post_dropoff'].includes(record.status)) group.dropoff += 1
    else if (['pre_pickup', 'post_pickup'].includes(record.status)) group.pickup += 1
    else if (record.status === 'done') group.done += 1
    else group.other += 1
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh-Hant'))
}
