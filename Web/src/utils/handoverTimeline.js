import { handoverStages, handoverTime } from './handoverSchedule.js'

// Reservation status names the next handover, not a completed checklist.
export function handoverTimelineProgress(rawStatus, mode = 'progress') {
  const status = !rawStatus || ['pending', 'service_booking'].includes(rawStatus)
    ? 'pre_dropoff' : rawStatus === 'pickup' ? 'pre_pickup' : rawStatus
  const currentIndex = handoverStages.findIndex(stage => stage.key === status)
  const preview = mode === 'preview'
  const summary = preview ? '' : status === 'done' ? '四階段交取車已完成'
    : status === 'cancelled' ? '此預約已取消'
      : currentIndex >= 0 ? `下一步：${handoverStages[currentIndex].label}` : '進度待確認'
  const stateLabels = { complete: '已完成', current: '目前待執行', upcoming: '尚未執行', cancelled: '已取消', unknown: '待確認', planned: '' }
  return {
    summary,
    steps: handoverStages.map((stage, index) => {
      const state = preview ? 'planned' : status === 'cancelled' ? 'cancelled'
        : status === 'done' ? 'complete' : currentIndex < 0 ? 'unknown'
          : index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
      return { ...stage, state, stateLabel: stateLabels[state] }
    }),
  }
}

export function handoverTimelineWindow(window) {
  const start = window?.startsAt ? new Date(window.startsAt).getTime() : NaN
  const end = window?.endsAt ? new Date(window.endsAt).getTime() : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '時間待公布'
  const from = handoverTime(window.startsAt).replaceAll('-', '/').replace('T', ' ')
  const to = handoverTime(window.endsAt).replaceAll('-', '/').replace('T', ' ')
  return `${from} ～ ${from.slice(0, 10) === to.slice(0, 10) ? to.slice(11) : to}`
}
